/*! RenderJs */
/*jslint nomen: true*/

/*
 * renderJs - Generic Gadget library renderer.
 * http://www.renderjs.org/documentation
 */
(function (document, window, RSVP, DOMParser, Channel, MutationObserver,
           Node, FileReader, Blob, navigator, Event, URL) {
  "use strict";

  if (window.hasOwnProperty("renderJS")) {
    return;
  }

  function readBlobAsDataURL(blob) {
    var fr = new FileReader();
    return new RSVP.Promise(function (resolve, reject) {
      fr.addEventListener("load", function (evt) {
        resolve(evt.target.result);
      });
      fr.addEventListener("error", reject);
      fr.readAsDataURL(blob);
    }, function () {
      fr.abort();
    });
  }

  function loopEventListener(target, type, useCapture, callback,
                             prevent_default) {
    //////////////////////////
    // Infinite event listener (promise is never resolved)
    // eventListener is removed when promise is cancelled/rejected
    //////////////////////////
    var handle_event_callback,
      callback_promise;

    if (prevent_default === undefined) {
      prevent_default = true;
    }

    function cancelResolver() {
      if ((callback_promise !== undefined) &&
          (typeof callback_promise.cancel === "function")) {
        callback_promise.cancel();
      }
    }

    function canceller() {
      if (handle_event_callback !== undefined) {
        target.removeEventListener(type, handle_event_callback, useCapture);
      }
      cancelResolver();
    }
    function itsANonResolvableTrap(resolve, reject) {
      var result;
      handle_event_callback = function (evt) {
        if (prevent_default) {
          evt.stopPropagation();
          evt.preventDefault();
        }

        cancelResolver();

        try {
          result = callback(evt);
        } catch (e) {
          result = RSVP.reject(e);
        }

        callback_promise = result;
        new RSVP.Queue()
          .push(function () {
            return result;
          })
          .push(undefined, function (error) {
            if (!(error instanceof RSVP.CancellationError)) {
              canceller();
              reject(error);
            }
          });
      };

      target.addEventListener(type, handle_event_callback, useCapture);
    }
    return new RSVP.Promise(itsANonResolvableTrap, canceller);
  }

  function ajax(url) {
    var xhr;
    function resolver(resolve, reject) {
      function handler() {
        try {
          if (xhr.readyState === 0) {
            // UNSENT
            reject(xhr);
          } else if (xhr.readyState === 4) {
            // DONE
            if ((xhr.status < 200) || (xhr.status >= 300) ||
                (!/^text\/html[;]?/.test(
                  xhr.getResponseHeader("Content-Type") || ""
                ))) {
              reject(xhr);
            } else {
              resolve(xhr);
            }
          }
        } catch (e) {
          reject(e);
        }
      }

      xhr = new XMLHttpRequest();
      xhr.open("GET", url);
      xhr.onreadystatechange = handler;
      xhr.setRequestHeader('Accept', 'text/html');
      xhr.withCredentials = true;
      xhr.send();
    }

    function canceller() {
      if ((xhr !== undefined) && (xhr.readyState !== xhr.DONE)) {
        xhr.abort();
      }
    }
    return new RSVP.Promise(resolver, canceller);
  }

  var gadget_model_defer_dict = {},
    javascript_registration_dict = {},
    stylesheet_registration_dict = {},
    gadget_loading_klass_list = [],
    loading_klass_promise,
    renderJS,
    Monitor,
    scope_increment = 0,
    isAbsoluteOrDataURL = new RegExp('^(?:[a-z]+:)?//|data:', 'i'),
    is_page_unloaded = false,
    error_list = [],
    bootstrap_deferred_object = new RSVP.defer();

  window.addEventListener('error', function (error) {
    error_list.push(error);
  });

  window.addEventListener('beforeunload', function () {
    // XXX If another listener cancel the page unload,
    // it will not restore renderJS crash report
    is_page_unloaded = true;
  });

  /////////////////////////////////////////////////////////////////
  // Helper functions
  /////////////////////////////////////////////////////////////////
  function removeHash(url) {
    var index = url.indexOf('#');
    if (index > 0) {
      url = url.substring(0, index);
    }
    return url;
  }

  function letsCrash(e) {
    var i,
      body,
      container,
      paragraph,
      link,
      error;
    if (is_page_unloaded) {
      /*global console*/
      console.info('-- Error dropped, as page is unloaded');
      console.info(e);
      return;
    }

    error_list.push(e);
    // Add error handling stack
    error_list.push(new Error('stopping renderJS'));

    body = document.getElementsByTagName('body')[0];
    while (body.firstChild) {
      body.removeChild(body.firstChild);
    }

    container = document.createElement("section");
    paragraph = document.createElement("h1");
    paragraph.textContent = 'Unhandled Error';
    container.appendChild(paragraph);

    paragraph = document.createElement("p");
    paragraph.textContent = 'Please report this error to the support team';
    container.appendChild(paragraph);

    paragraph = document.createElement("p");
    paragraph.textContent = 'Location: ';
    link = document.createElement("a");
    link.href = link.textContent = window.location.toString();
    paragraph.appendChild(link);
    container.appendChild(paragraph);

    paragraph = document.createElement("p");
    paragraph.textContent = 'User-agent: ' + navigator.userAgent;
    container.appendChild(paragraph);

    paragraph = document.createElement("p");
    paragraph.textContent = 'Date: ' + new Date(Date.now()).toISOString();
    container.appendChild(paragraph);

    body.appendChild(container);

    for (i = 0; i < error_list.length; i += 1) {
      error = error_list[i];

      if (error instanceof Event) {
        error = {
          string: error.toString(),
          message: error.message,
          type: error.type,
          target: error.target
        };
        if (error.target !== undefined) {
          error_list.splice(i + 1, 0, error.target);
        }
      }

      if (error instanceof XMLHttpRequest) {
        error = {
          message: error.toString(),
          readyState: error.readyState,
          status: error.status,
          statusText: error.statusText,
          response: error.response,
          responseUrl: error.responseUrl,
          response_headers: error.getAllResponseHeaders()
        };
      }
      if (error.constructor === Array ||
          error.constructor === String ||
          error.constructor === Object) {
        try {
          error = JSON.stringify(error);
        } catch (ignore) {
        }
      }

      container = document.createElement("section");

      paragraph = document.createElement("h2");
      paragraph.textContent = error.message || error;
      container.appendChild(paragraph);

      if (error.fileName !== undefined) {
        paragraph = document.createElement("p");
        paragraph.textContent = 'File: ' +
          error.fileName +
          ': ' + error.lineNumber;
        container.appendChild(paragraph);
      }

      if (error.stack !== undefined) {
        paragraph = document.createElement("pre");
        paragraph.textContent = 'Stack: ' + error.stack;
        container.appendChild(paragraph);
      }

      body.appendChild(container);
    }
    // XXX Do not crash the application if it fails
    // Where to write the error?
    /*global console*/
    console.error(e.stack);
    console.error(e);
  }

  /////////////////////////////////////////////////////////////////
  // Service Monitor promise
  /////////////////////////////////////////////////////////////////
  function ResolvedMonitorError(message) {
    this.name = "resolved";
    if ((message !== undefined) && (typeof message !== "string")) {
      throw new TypeError('You must pass a string.');
    }
    this.message = message || "Default Message";
  }
  ResolvedMonitorError.prototype = new Error();
  ResolvedMonitorError.prototype.constructor = ResolvedMonitorError;

  Monitor = function () {
    var monitor = this,
      promise_list = [],
      promise,
      reject,
      notify,
      resolved;

    if (!(this instanceof Monitor)) {
      return new Monitor();
    }

    function canceller() {
      var len = promise_list.length,
        i;
      for (i = 0; i < len; i += 1) {
        promise_list[i].cancel();
      }
      // Clean it to speed up other canceller run
      promise_list = [];
    }

    promise = new RSVP.Promise(function (done, fail, progress) {
      reject = function (rejectedReason) {
        if (resolved) {
          return;
        }
        monitor.isRejected = true;
        monitor.rejectedReason = rejectedReason;
        resolved = true;
        canceller();
        return fail(rejectedReason);
      };
      notify = progress;
    }, canceller);

    monitor.cancel = function () {
      if (resolved) {
        return;
      }
      resolved = true;
      promise.cancel();
      promise.fail(function (rejectedReason) {
        monitor.isRejected = true;
        monitor.rejectedReason = rejectedReason;
      });
    };
    monitor.then = function () {
      return promise.then.apply(promise, arguments);
    };
    monitor.fail = function () {
      return promise.fail.apply(promise, arguments);
    };

    monitor.monitor = function (promise_to_monitor) {
      if (resolved) {
        throw new ResolvedMonitorError();
      }
      var queue = new RSVP.Queue()
        .push(function () {
          return promise_to_monitor;
        })
        .push(function (fulfillmentValue) {
          // Promise to monitor is fullfilled, remove it from the list
          var len = promise_list.length,
            sub_promise_to_monitor,
            new_promise_list = [],
            i;
          for (i = 0; i < len; i += 1) {
            sub_promise_to_monitor = promise_list[i];
            if (!(sub_promise_to_monitor.isFulfilled ||
                sub_promise_to_monitor.isRejected)) {
              new_promise_list.push(sub_promise_to_monitor);
            }
          }
          promise_list = new_promise_list;
        }, function (rejectedReason) {
          if (rejectedReason instanceof RSVP.CancellationError) {
            if (!(promise_to_monitor.isFulfilled &&
                  promise_to_monitor.isRejected)) {
              // The queue could be cancelled before the first push is run
              promise_to_monitor.cancel();
            }
          }
          reject(rejectedReason);
          throw rejectedReason;
        }, function (notificationValue) {
          notify(notificationValue);
          return notificationValue;
        });

      promise_list.push(queue);

      return this;
    };
  };

  Monitor.prototype = Object.create(RSVP.Promise.prototype);
  Monitor.prototype.constructor = Monitor;

  /////////////////////////////////////////////////////////////////
  // RenderJSGadget
  /////////////////////////////////////////////////////////////////
  function RenderJSGadget() {
    if (!(this instanceof RenderJSGadget)) {
      return new RenderJSGadget();
    }
  }
  RenderJSGadget.prototype.__title = "";
  RenderJSGadget.prototype.__interface_list = [];
  RenderJSGadget.prototype.__path = "";
  RenderJSGadget.prototype.__html = "";
  RenderJSGadget.prototype.__required_css_list = [];
  RenderJSGadget.prototype.__required_js_list = [];

  function createMonitor(g) {
    if (g.__monitor !== undefined) {
      g.__monitor.cancel();
    }
    g.__monitor = new Monitor();
    g.__job_dict = {};
    g.__job_list = [];
    g.__job_triggered = false;
    g.__monitor.fail(function (error) {
      if (!(error instanceof RSVP.CancellationError)) {
        return g.aq_reportServiceError(error);
      }
    }).fail(function (error) {
      // Crash the application if the acquisition generates an error.
      return letsCrash(error);
    });
  }

  function clearGadgetInternalParameters(g) {
    g.__sub_gadget_dict = {};
    createMonitor(g);
  }

  function loadSubGadgetDOMDeclaration(g) {
    var element_list = g.element.querySelectorAll('[data-gadget-url]'),
      element,
      promise_list = [],
      scope,
      url,
      sandbox,
      i;

    for (i = 0; i < element_list.length; i += 1) {
      element = element_list[i];
      scope = element.getAttribute("data-gadget-scope");
      url = element.getAttribute("data-gadget-url");
      sandbox = element.getAttribute("data-gadget-sandbox");
      if (url !== null) {
        promise_list.push(g.declareGadget(url, {
          element: element,
          scope: scope || undefined,
          sandbox: sandbox || undefined
        }));
      }
    }

    return RSVP.all(promise_list);
  }

  RenderJSGadget.__ready_list = [clearGadgetInternalParameters,
                                 loadSubGadgetDOMDeclaration];
  RenderJSGadget.ready = function (callback) {
    this.__ready_list.push(callback);
    return this;
  };
  RenderJSGadget.setState = function (state_dict) {
    var json_state = JSON.stringify(state_dict);
    return this.ready(function () {
      this.state = JSON.parse(json_state);
    });
  };
  RenderJSGadget.onStateChange = function (callback) {
    this.prototype.__state_change_callback = callback;
    return this;
  };

  RenderJSGadget.__service_list = [];
  RenderJSGadget.declareService = function (callback) {
    this.__service_list.push(callback);
    return this;
  };
  RenderJSGadget.onEvent = function (type, callback, use_capture,
                                     prevent_default) {
    this.__service_list.push(function () {
      return loopEventListener(this.element, type, use_capture,
                               callback.bind(this), prevent_default);
    });
    return this;
  };

  function runJob(gadget, name, callback, argument_list) {
    var job_promise = new RSVP.Queue()
      .push(function () {
        return callback.apply(gadget, argument_list);
      });
    if (gadget.__job_dict.hasOwnProperty(name)) {
      gadget.__job_dict[name].cancel();
    }
    gadget.__job_dict[name] = job_promise;
    gadget.__monitor.monitor(new RSVP.Queue()
      .push(function () {
        return job_promise;
      })
      .push(undefined, function (error) {
        if (!(error instanceof RSVP.CancellationError)) {
          throw error;
        }
      }));
  }

  function startService(gadget) {
    gadget.__monitor.monitor(new RSVP.Queue()
      .push(function () {
        var i,
          service_list = gadget.constructor.__service_list,
          job_list = gadget.__job_list;
        for (i = 0; i < service_list.length; i += 1) {
          gadget.__monitor.monitor(service_list[i].apply(gadget));
        }
        for (i = 0; i < job_list.length; i += 1) {
          runJob(gadget, job_list[i][0], job_list[i][1], job_list[i][2]);
        }
        gadget.__job_list = [];
        gadget.__job_triggered = true;
      })
      );
  }

  /////////////////////////////////////////////////////////////////
  // RenderJSGadget.declareJob
  // gadget internal method, which trigger execution
  // of a function inside a service
  /////////////////////////////////////////////////////////////////
  RenderJSGadget.declareJob = function (name, callback) {
    this.prototype[name] = function () {
      var context = this,
        argument_list = arguments;

      if (context.__job_triggered) {
        runJob(context, name, callback, argument_list);
      } else {
        context.__job_list.push([name, callback, argument_list]);
      }
    };
    // Allow chain
    return this;
  };

  /////////////////////////////////////////////////////////////////
  // RenderJSGadget.declareMethod
  /////////////////////////////////////////////////////////////////
  RenderJSGadget.declareMethod = function (name, callback) {
    this.prototype[name] = function () {
      var context = this,
        argument_list = arguments;

      return new RSVP.Queue()
        .push(function () {
          return callback.apply(context, argument_list);
        });
    };
    // Allow chain
    return this;
  };

  RenderJSGadget
    .declareMethod('getInterfaceList', function () {
      // Returns the list of gadget prototype
      return this.__interface_list;
    })
    .declareMethod('getRequiredCSSList', function () {
      // Returns a list of CSS required by the gadget
      return this.__required_css_list;
    })
    .declareMethod('getRequiredJSList', function () {
      // Returns a list of JS required by the gadget
      return this.__required_js_list;
    })
    .declareMethod('getPath', function () {
      // Returns the path of the code of a gadget
      return this.__path;
    })
    .declareMethod('getTitle', function () {
      // Returns the title of a gadget
      return this.__title;
    })
    .declareMethod('getElement', function () {
      // Returns the DOM Element of a gadget
      // XXX Kept for compatibility. Use element property directly
      if (this.element === undefined) {
        throw new Error("No element defined");
      }
      return this.element;
    })
    .declareMethod('changeState', function (state_dict) {
      var key,
        modified = false,
        previous_cancelled = this.hasOwnProperty('__modification_dict'),
        modification_dict,
        context = this;
      if (previous_cancelled) {
        modification_dict = this.__modification_dict;
        modified = true;
      } else {
        modification_dict = {};
        this.__modification_dict = modification_dict;
      }
      for (key in state_dict) {
        if (state_dict.hasOwnProperty(key) &&
            (state_dict[key] !== this.state[key])) {
          this.state[key] = state_dict[key];
          modification_dict[key] = state_dict[key];
          modified = true;
        }
      }
      if (modified && this.__state_change_callback !== undefined) {
        return new RSVP.Queue()
          .push(function () {
            return context.__state_change_callback(modification_dict);
          })
          .push(function (result) {
            delete context.__modification_dict;
            return result;
          });
      }
    });

  /////////////////////////////////////////////////////////////////
  // RenderJSGadget.declareAcquiredMethod
  /////////////////////////////////////////////////////////////////
  function acquire(child_gadget, method_name, argument_list) {
    var gadget = this,
      key,
      gadget_scope;

    for (key in gadget.__sub_gadget_dict) {
      if (gadget.__sub_gadget_dict.hasOwnProperty(key)) {
        if (gadget.__sub_gadget_dict[key] === child_gadget) {
          gadget_scope = key;
        }
      }
    }
    return new RSVP.Queue()
      .push(function () {
        // Do not specify default __acquired_method_dict on prototype
        // to prevent modifying this default value (with
        // allowPublicAcquiredMethod for example)
        var aq_dict = gadget.__acquired_method_dict || {};
        if (aq_dict.hasOwnProperty(method_name)) {
          return aq_dict[method_name].apply(gadget,
                                            [argument_list, gadget_scope]);
        }
        throw new renderJS.AcquisitionError("aq_dynamic is not defined");
      })
      .push(undefined, function (error) {
        if (error instanceof renderJS.AcquisitionError) {
          return gadget.__aq_parent(method_name, argument_list);
        }
        throw error;
      });
  }

  RenderJSGadget.declareAcquiredMethod =
    function (name, method_name_to_acquire) {
      this.prototype[name] = function () {
        var argument_list = Array.prototype.slice.call(arguments, 0),
          gadget = this;
        return new RSVP.Queue()
          .push(function () {
            return gadget.__aq_parent(method_name_to_acquire, argument_list);
          });
      };

      // Allow chain
      return this;
    };
  RenderJSGadget.declareAcquiredMethod("aq_reportServiceError",
                                       "reportServiceError");

  /////////////////////////////////////////////////////////////////
  // RenderJSGadget.allowPublicAcquisition
  /////////////////////////////////////////////////////////////////
  RenderJSGadget.allowPublicAcquisition =
    function (method_name, callback) {
      this.prototype.__acquired_method_dict[method_name] = callback;

      // Allow chain
      return this;
    };

  // Set aq_parent on gadget_instance which call acquire on parent_gadget
  function setAqParent(gadget_instance, parent_gadget) {
    gadget_instance.__aq_parent = function (method_name, argument_list) {
      return acquire.apply(parent_gadget, [gadget_instance, method_name,
                                           argument_list]);
    };
  }

  /////////////////////////////////////////////////////////////////
  // RenderJSEmbeddedGadget
  /////////////////////////////////////////////////////////////////
  // Class inheritance
  function RenderJSEmbeddedGadget() {
    if (!(this instanceof RenderJSEmbeddedGadget)) {
      return new RenderJSEmbeddedGadget();
    }
    RenderJSGadget.call(this);
  }
  RenderJSEmbeddedGadget.__ready_list = RenderJSGadget.__ready_list.slice();
  RenderJSEmbeddedGadget.__service_list =
    RenderJSGadget.__service_list.slice();
  RenderJSEmbeddedGadget.ready =
    RenderJSGadget.ready;
  RenderJSEmbeddedGadget.setState =
    RenderJSGadget.setState;
  RenderJSEmbeddedGadget.onStateChange =
    RenderJSGadget.onStateChange;
  RenderJSEmbeddedGadget.declareService =
    RenderJSGadget.declareService;
  RenderJSEmbeddedGadget.onEvent =
    RenderJSGadget.onEvent;
  RenderJSEmbeddedGadget.prototype = new RenderJSGadget();
  RenderJSEmbeddedGadget.prototype.constructor = RenderJSEmbeddedGadget;

  /////////////////////////////////////////////////////////////////
  // privateDeclarePublicGadget
  /////////////////////////////////////////////////////////////////
  function privateDeclarePublicGadget(url, options, parent_gadget) {

    return new RSVP.Queue()
      .push(function () {
        return renderJS.declareGadgetKlass(url)
          // gadget loading should not be interrupted
          // if not, gadget's definition will not be complete
          //.then will return another promise
          //so loading_klass_promise can't be cancel
          .then(function (result) {
            return result;
          });
      })
      // Get the gadget class and instanciate it
      .push(function (Klass) {
        if (options.element === undefined) {
          options.element = document.createElement("div");
        }
        var i,
          gadget_instance,
          template_node_list = Klass.__template_element.body.childNodes,
          fragment = document.createDocumentFragment();
        gadget_instance = new Klass();
        gadget_instance.element = options.element;
        gadget_instance.state = {};
        for (i = 0; i < template_node_list.length; i += 1) {
          fragment.appendChild(
            template_node_list[i].cloneNode(true)
          );
        }
        gadget_instance.element.appendChild(fragment);
        setAqParent(gadget_instance, parent_gadget);
        return gadget_instance;
      });
  }

  /////////////////////////////////////////////////////////////////
  // RenderJSIframeGadget
  /////////////////////////////////////////////////////////////////
  function RenderJSIframeGadget() {
    if (!(this instanceof RenderJSIframeGadget)) {
      return new RenderJSIframeGadget();
    }
    RenderJSGadget.call(this);
  }
  RenderJSIframeGadget.__ready_list = RenderJSGadget.__ready_list.slice();
  RenderJSIframeGadget.ready =
    RenderJSGadget.ready;
  RenderJSIframeGadget.setState =
    RenderJSGadget.setState;
  RenderJSIframeGadget.onStateChange =
    RenderJSGadget.onStateChange;
  RenderJSIframeGadget.__service_list = RenderJSGadget.__service_list.slice();
  RenderJSIframeGadget.declareService =
    RenderJSGadget.declareService;
  RenderJSIframeGadget.onEvent =
    RenderJSGadget.onEvent;
  RenderJSIframeGadget.prototype = new RenderJSGadget();
  RenderJSIframeGadget.prototype.constructor = RenderJSIframeGadget;

  /////////////////////////////////////////////////////////////////
  // privateDeclareIframeGadget
  /////////////////////////////////////////////////////////////////
  function privateDeclareIframeGadget(url, options, parent_gadget) {
    var gadget_instance,
      iframe,
      iframe_loading_deferred = RSVP.defer();
    if (options.element === undefined) {
      throw new Error("DOM element is required to create Iframe Gadget " +
                      url);
    }

    // Check if the element is attached to the DOM
    if (!document.contains(options.element)) {
      throw new Error("The parent element is not attached to the DOM for " +
                      url);
    }

    gadget_instance = new RenderJSIframeGadget();
    setAqParent(gadget_instance, parent_gadget);
    iframe = document.createElement("iframe");
//    gadget_instance.element.setAttribute("seamless", "seamless");
    iframe.setAttribute("src", url);
    gadget_instance.__path = url;
    gadget_instance.element = options.element;
    gadget_instance.state = {};
    // Attach it to the DOM
    options.element.appendChild(iframe);

    // XXX Manage unbind when deleting the gadget

    // Create the communication channel with the iframe
    gadget_instance.__chan = Channel.build({
      window: iframe.contentWindow,
      origin: "*",
      scope: "renderJS"
    });

    // Create new method from the declareMethod call inside the iframe
    gadget_instance.__chan.bind("declareMethod",
                                function (trans, method_name) {
        gadget_instance[method_name] = function () {
          var argument_list = arguments,
            wait_promise = new RSVP.Promise(function (resolve, reject) {
              gadget_instance.__chan.call({
                method: "methodCall",
                params: [
                  method_name,
                  Array.prototype.slice.call(argument_list, 0)],
                success: function (s) {
                  resolve(s);
                },
                error: function (e) {
                  reject(e);
                }
              });
            });
          return new RSVP.Queue()
            .push(function () {
              return wait_promise;
            });
        };
        return "OK";
      });

    // Wait for the iframe to be loaded before continuing
    gadget_instance.__chan.bind("ready", function (trans) {
      iframe_loading_deferred.resolve(gadget_instance);
      return "OK";
    });
    gadget_instance.__chan.bind("failed", function (trans, params) {
      iframe_loading_deferred.reject(params);
      return "OK";
    });
    gadget_instance.__chan.bind("acquire", function (trans, params) {
      gadget_instance.__aq_parent.apply(gadget_instance, params)
        .then(function (g) {
          trans.complete(g);
        }).fail(function (e) {
          trans.error(e.toString());
        });
      trans.delayReturn(true);
    });

    return RSVP.any([
      iframe_loading_deferred.promise,
      // Timeout to prevent non renderJS embeddable gadget
      // XXX Maybe using iframe.onload/onerror would be safer?
      new RSVP.Queue()
        .push(function () {
          return RSVP.timeout(5000);
        })
        .push(undefined, function () {
          throw new Error('Timeout while loading: ' + url);
        })
    ]);
  }

  /////////////////////////////////////////////////////////////////
  // privateDeclareDataUrlGadget
  /////////////////////////////////////////////////////////////////
  function privateDeclareDataUrlGadget(url, options, parent_gadget) {

    return new RSVP.Queue()
      .push(function () {
        return ajax(url);
      })
      .push(function (xhr) {
        // Insert a "base" element, in order to resolve all relative links
        // which could get broken with a data url
        var doc = (new DOMParser()).parseFromString(xhr.responseText,
                                                    'text/html'),
          base = doc.createElement('base'),
          blob;
        base.href = url;
        doc.head.insertBefore(base, doc.head.firstChild);
        blob = new Blob([doc.documentElement.outerHTML],
                        {type: "text/html;charset=UTF-8"});
        return readBlobAsDataURL(blob);
      })
      .push(function (data_url) {
        return privateDeclareIframeGadget(data_url, options, parent_gadget);
      });
  }

  /////////////////////////////////////////////////////////////////
  // RenderJSGadget.declareGadget
  /////////////////////////////////////////////////////////////////
  RenderJSGadget
    .declareMethod('declareGadget', function (url, options) {
      var parent_gadget = this;

      if (options === undefined) {
        options = {};
      }
      if (options.sandbox === undefined) {
        options.sandbox = "public";
      }

      // transform url to absolute url if it is relative
      url = renderJS.getAbsoluteURL(url, this.__path);

      return new RSVP.Queue()
        .push(function () {
          var method;
          if (options.sandbox === "public") {
            method = privateDeclarePublicGadget;
          } else if (options.sandbox === "iframe") {
            method = privateDeclareIframeGadget;
          } else if (options.sandbox === "dataurl") {
            method = privateDeclareDataUrlGadget;
          } else {
            throw new Error("Unsupported sandbox options '" +
                            options.sandbox + "'");
          }
          return method(url, options, parent_gadget);
        })
        // Set the HTML context
        .push(function (gadget_instance) {
          var i,
            scope,
            queue = new RSVP.Queue();
          // Trigger calling of all ready callback
          function ready_wrapper() {
            return gadget_instance;
          }
          function ready_executable_wrapper(fct) {
            return function () {
              return fct.call(gadget_instance, gadget_instance);
            };
          }
          for (i = 0; i < gadget_instance.constructor.__ready_list.length;
               i += 1) {
            // Put a timeout?
            queue.push(ready_executable_wrapper(
              gadget_instance.constructor.__ready_list[i]
            ));
            // Always return the gadget instance after ready function
            queue.push(ready_wrapper);
          }

          // Store local reference to the gadget instance
          scope = options.scope;
          if (scope === undefined) {
            scope = 'RJS_' + scope_increment;
            scope_increment += 1;
            while (parent_gadget.__sub_gadget_dict.hasOwnProperty(scope)) {
              scope = 'RJS_' + scope_increment;
              scope_increment += 1;
            }
          }
          parent_gadget.__sub_gadget_dict[scope] = gadget_instance;
          gadget_instance.element.setAttribute("data-gadget-scope",
                                               scope);

          // Put some attribute to ease page layout comprehension
          gadget_instance.element.setAttribute("data-gadget-url", url);
          gadget_instance.element.setAttribute("data-gadget-sandbox",
                                               options.sandbox);
          gadget_instance.element._gadget = gadget_instance;

          if (document.contains(gadget_instance.element)) {
            // Put a timeout
            queue.push(startService);
          }
          // Always return the gadget instance after ready function
          queue.push(ready_wrapper);

          return queue;
        });
    })
    .declareMethod('getDeclaredGadget', function (gadget_scope) {
      if (!this.__sub_gadget_dict.hasOwnProperty(gadget_scope)) {
        throw new Error("Gadget scope '" + gadget_scope + "' is not known.");
      }
      return this.__sub_gadget_dict[gadget_scope];
    })
    .declareMethod('dropGadget', function (gadget_scope) {
      if (!this.__sub_gadget_dict.hasOwnProperty(gadget_scope)) {
        throw new Error("Gadget scope '" + gadget_scope + "' is not known.");
      }
      // http://perfectionkills.com/understanding-delete/
      delete this.__sub_gadget_dict[gadget_scope];
    });

  /////////////////////////////////////////////////////////////////
  // renderJS selector
  /////////////////////////////////////////////////////////////////
  renderJS = function (selector) {
    var result;
    if (selector === window) {
      // window is the 'this' value when loading a javascript file
      // In this case, use the current loading gadget constructor
      result = gadget_loading_klass_list[0];
    }
    if (result === undefined) {
      throw new Error("Unknown selector '" + selector + "'");
    }
    return result;
  };

  /////////////////////////////////////////////////////////////////
  // renderJS.AcquisitionError
  /////////////////////////////////////////////////////////////////
  renderJS.AcquisitionError = function (message) {
    this.name = "AcquisitionError";
    if ((message !== undefined) && (typeof message !== "string")) {
      throw new TypeError('You must pass a string.');
    }
    this.message = message || "Acquisition failed";
  };
  renderJS.AcquisitionError.prototype = new Error();
  renderJS.AcquisitionError.prototype.constructor =
    renderJS.AcquisitionError;

  /////////////////////////////////////////////////////////////////
  // renderJS.getAbsoluteURL
  /////////////////////////////////////////////////////////////////
  renderJS.getAbsoluteURL = function (url, base_url) {
    if (base_url && url) {
      return new URL(url, base_url).href;
    }
    return url;
  };

  /////////////////////////////////////////////////////////////////
  // renderJS.declareJS
  /////////////////////////////////////////////////////////////////
  renderJS.declareJS = function (url, container, pop) {
    // https://www.html5rocks.com/en/tutorials/speed/script-loading/
    // Prevent infinite recursion if loading render.js
    // more than once
    var result;
    if (javascript_registration_dict.hasOwnProperty(url)) {
      result = RSVP.resolve();
    } else {
      javascript_registration_dict[url] = null;
      result = new RSVP.Promise(function (resolve, reject) {
        var newScript;
        newScript = document.createElement('script');
        newScript.async = false;
        newScript.type = 'text/javascript';
        newScript.onload = function () {
          if (pop === true) {
            // Drop the current loading klass info used by selector
            gadget_loading_klass_list.shift();
          }
          resolve();
        };
        newScript.onerror = function (e) {
          if (pop === true) {
            // Drop the current loading klass info used by selector
            gadget_loading_klass_list.shift();
          }
          reject(e);
        };
        newScript.src = url;
        container.appendChild(newScript);
      });
    }
    return result;
  };

  /////////////////////////////////////////////////////////////////
  // renderJS.declareCSS
  /////////////////////////////////////////////////////////////////
  renderJS.declareCSS = function (url, container) {
    // https://github.com/furf/jquery-getCSS/blob/master/jquery.getCSS.js
    // No way to cleanly check if a css has been loaded
    // So, always resolve the promise...
    // http://requirejs.org/docs/faq-advanced.html#css
    var result;
    if (stylesheet_registration_dict.hasOwnProperty(url)) {
      result = RSVP.resolve();
    } else {
      result = new RSVP.Promise(function (resolve, reject) {
        var link;
        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.type = 'text/css';
        link.href = url;
        link.onload = function () {
          stylesheet_registration_dict[url] = null;
          resolve();
        };
        link.onerror = function (e) {
          reject(e);
        };
        container.appendChild(link);
      });
    }
    return result;
  };

  /////////////////////////////////////////////////////////////////
  // renderJS.declareGadgetKlass
  /////////////////////////////////////////////////////////////////

  function parse(xhr, url) {
    var tmp_constructor,
      key,
      parsed_html;
    // Class inheritance
    tmp_constructor = function () {
      RenderJSGadget.call(this);
    };
    tmp_constructor.__ready_list = RenderJSGadget.__ready_list.slice();
    tmp_constructor.__service_list = RenderJSGadget.__service_list.slice();
    tmp_constructor.declareMethod =
      RenderJSGadget.declareMethod;
    tmp_constructor.declareJob =
      RenderJSGadget.declareJob;
    tmp_constructor.declareAcquiredMethod =
      RenderJSGadget.declareAcquiredMethod;
    tmp_constructor.allowPublicAcquisition =
      RenderJSGadget.allowPublicAcquisition;
    tmp_constructor.ready =
      RenderJSGadget.ready;
    tmp_constructor.setState =
      RenderJSGadget.setState;
    tmp_constructor.onStateChange =
      RenderJSGadget.onStateChange;
    tmp_constructor.declareService =
      RenderJSGadget.declareService;
    tmp_constructor.onEvent =
      RenderJSGadget.onEvent;
    tmp_constructor.prototype = new RenderJSGadget();
    tmp_constructor.prototype.constructor = tmp_constructor;
    tmp_constructor.prototype.__path = url;
    tmp_constructor.prototype.__acquired_method_dict = {};
    // https://developer.mozilla.org/en-US/docs/HTML_in_XMLHttpRequest
    // https://developer.mozilla.org/en-US/docs/Web/API/DOMParser
    // https://developer.mozilla.org/en-US/docs/Code_snippets/HTML_to_DOM
    tmp_constructor.__template_element =
      (new DOMParser()).parseFromString(xhr.responseText, "text/html");
    parsed_html = renderJS.parseGadgetHTMLDocument(
      tmp_constructor.__template_element,
      url
    );
    for (key in parsed_html) {
      if (parsed_html.hasOwnProperty(key)) {
        tmp_constructor.prototype['__' + key] = parsed_html[key];
      }
    }
    return tmp_constructor;
  }

  renderJS.declareGadgetKlass = function (url) {
    if (gadget_model_defer_dict.hasOwnProperty(url)) {
      // Return klass object if it already exists
      return gadget_model_defer_dict[url].promise;
    }

    var tmp_constructor,
      defer = RSVP.defer();

    gadget_model_defer_dict[url] = defer;

    // Change the global variable to update the loading queue
    loading_klass_promise = defer.promise;

    // Fetch the HTML page and parse it
    return new RSVP.Queue()
      .push(function () {
        return ajax(url);
      })
      .push(function (result) {
        tmp_constructor = parse(result, url);
        var fragment = document.createDocumentFragment(),
          promise_list = [],
          i,
          js_list = tmp_constructor.prototype.__required_js_list,
          css_list = tmp_constructor.prototype.__required_css_list;
        // Load JS
        if (js_list.length) {
          gadget_loading_klass_list.push(tmp_constructor);
          for (i = 0; i < js_list.length - 1; i += 1) {
            promise_list.push(renderJS.declareJS(js_list[i], fragment));
          }
          promise_list.push(renderJS.declareJS(js_list[i], fragment, true));
        }
        // Load CSS
        for (i = 0; i < css_list.length; i += 1) {
          promise_list.push(renderJS.declareCSS(css_list[i], fragment));
        }
        document.head.appendChild(fragment);
        return RSVP.all(promise_list);
      })
      .push(function () {
        defer.resolve(tmp_constructor);
        return tmp_constructor;
      })
      .push(undefined, function (e) {
        // Drop the current loading klass info used by selector
        // even in case of error
        defer.reject(e);
        throw e;
      });
  };

  /////////////////////////////////////////////////////////////////
  // renderJS.clearGadgetKlassList
  /////////////////////////////////////////////////////////////////
  // For test purpose only
  renderJS.clearGadgetKlassList = function () {
    gadget_model_defer_dict = {};
    javascript_registration_dict = {};
    stylesheet_registration_dict = {};
  };

  /////////////////////////////////////////////////////////////////
  // renderJS.parseGadgetHTMLDocument
  /////////////////////////////////////////////////////////////////
  renderJS.parseGadgetHTMLDocument = function (document_element, url) {
    var settings = {
        title: "",
        interface_list: [],
        required_css_list: [],
        required_js_list: []
      },
      i,
      element;

    if (!url || !isAbsoluteOrDataURL.test(url)) {
      throw new Error("The url should be absolute: " + url);
    }

    if (document_element.nodeType === 9) {
      settings.title = document_element.title;

      if (document_element.head !== null) {
        for (i = 0; i < document_element.head.children.length; i += 1) {
          element = document_element.head.children[i];
          if (element.href !== null) {
            // XXX Manage relative URL during extraction of URLs
            // element.href returns absolute URL in firefox but "" in chrome;
            if (element.rel === "stylesheet") {
              settings.required_css_list.push(
                renderJS.getAbsoluteURL(element.getAttribute("href"), url)
              );
            } else if (element.nodeName === "SCRIPT" &&
                       (element.type === "text/javascript" ||
                        !element.type)) {
              settings.required_js_list.push(
                renderJS.getAbsoluteURL(element.getAttribute("src"), url)
              );
            } else if (element.rel ===
                       "http://www.renderjs.org/rel/interface") {
              settings.interface_list.push(
                renderJS.getAbsoluteURL(element.getAttribute("href"), url)
              );
            }
          }
        }
      }
    } else {
      throw new Error("The first parameter should be an HTMLDocument");
    }
    return settings;
  };

  /////////////////////////////////////////////////////////////////
  // global
  /////////////////////////////////////////////////////////////////
  window.rJS = window.renderJS = renderJS;
  window.__RenderJSGadget = RenderJSGadget;
  window.__RenderJSEmbeddedGadget = RenderJSEmbeddedGadget;
  window.__RenderJSIframeGadget = RenderJSIframeGadget;

  ///////////////////////////////////////////////////
  // Bootstrap process. Register the self gadget.
  ///////////////////////////////////////////////////


  // Manually initializes the self gadget if the DOMContentLoaded event
  // is triggered before everything was ready.
  // (For instance, the HTML-tag for the self gadget gets inserted after
  //  page load)
  renderJS.manualBootstrap = function () {
    bootstrap_deferred_object.resolve();
  };


  function bootstrap() {
    var url = removeHash(window.location.href),
      TmpConstructor,
      root_gadget,
      loading_gadget_promise = new RSVP.Queue(),
      declare_method_count = 0,
      embedded_channel,
      notifyReady,
      notifyDeclareMethod,
      gadget_ready = false,
      iframe_top_gadget,
      last_acquisition_gadget,
      declare_method_list_waiting = [],
      gadget_failed = false,
      gadget_error,
      connection_ready = false;

    // Create the gadget class for the current url
    if (gadget_model_defer_dict.hasOwnProperty(url)) {
      throw new Error("bootstrap should not be called twice");
    }
    loading_klass_promise = new RSVP.Promise(function (resolve, reject) {

      last_acquisition_gadget = new RenderJSGadget();
      last_acquisition_gadget.__acquired_method_dict = {
        reportServiceError: function (param_list) {
          letsCrash(param_list[0]);
        }
      };
      // Stop acquisition on the last acquisition gadget
      // Do not put this on the klass, as their could be multiple instances
      last_acquisition_gadget.__aq_parent = function (method_name) {
        throw new renderJS.AcquisitionError(
          "No gadget provides " + method_name
        );
      };

      //we need to determine tmp_constructor's value before exit bootstrap
      //because of function : renderJS
      //but since the channel checking is async,
      //we can't use code structure like:
      // if channel communication is ok
      //    tmp_constructor = RenderJSGadget
      // else
      //    tmp_constructor = RenderJSEmbeddedGadget
      if (window.self === window.top) {
        // XXX Copy/Paste from declareGadgetKlass
        TmpConstructor = function () {
          RenderJSGadget.call(this);
        };
        TmpConstructor.declareMethod = RenderJSGadget.declareMethod;
        TmpConstructor.declareJob = RenderJSGadget.declareJob;
        TmpConstructor.declareAcquiredMethod =
          RenderJSGadget.declareAcquiredMethod;
        TmpConstructor.allowPublicAcquisition =
          RenderJSGadget.allowPublicAcquisition;
        TmpConstructor.__ready_list = RenderJSGadget.__ready_list.slice();
        TmpConstructor.ready = RenderJSGadget.ready;
        TmpConstructor.setState = RenderJSGadget.setState;
        TmpConstructor.onStateChange = RenderJSGadget.onStateChange;
        TmpConstructor.__service_list = RenderJSGadget.__service_list.slice();
        TmpConstructor.declareService =
          RenderJSGadget.declareService;
        TmpConstructor.onEvent =
          RenderJSGadget.onEvent;
        TmpConstructor.prototype = new RenderJSGadget();
        TmpConstructor.prototype.constructor = TmpConstructor;
        TmpConstructor.prototype.__path = url;
        gadget_model_defer_dict[url] = {
          promise: RSVP.resolve(TmpConstructor)
        };

        // Create the root gadget instance and put it in the loading stack
        root_gadget = new TmpConstructor();

        setAqParent(root_gadget, last_acquisition_gadget);

      } else {
        // Create the root gadget instance and put it in the loading stack
        TmpConstructor = RenderJSEmbeddedGadget;
        TmpConstructor.__ready_list = RenderJSGadget.__ready_list.slice();
        TmpConstructor.__service_list = RenderJSGadget.__service_list.slice();
        TmpConstructor.prototype.__path = url;
        root_gadget = new RenderJSEmbeddedGadget();
        setAqParent(root_gadget, last_acquisition_gadget);

        // Create the communication channel
        embedded_channel = Channel.build({
          window: window.parent,
          origin: "*",
          scope: "renderJS",
          onReady: function () {
            var k;
            iframe_top_gadget = false;
            //Default: Define __aq_parent to inform parent window
            root_gadget.__aq_parent =
              TmpConstructor.prototype.__aq_parent = function (method_name,
                argument_list, time_out) {
                return new RSVP.Promise(function (resolve, reject) {
                  embedded_channel.call({
                    method: "acquire",
                    params: [
                      method_name,
                      argument_list
                    ],
                    success: function (s) {
                      resolve(s);
                    },
                    error: function (e) {
                      reject(e);
                    },
                    timeout: time_out
                  });
                });
              };

            // Channel is ready, so now declare Function
            notifyDeclareMethod = function (name) {
              declare_method_count += 1;
              embedded_channel.call({
                method: "declareMethod",
                params: name,
                success: function () {
                  declare_method_count -= 1;
                  notifyReady();
                },
                error: function () {
                  declare_method_count -= 1;
                }
              });
            };
            for (k = 0; k < declare_method_list_waiting.length; k += 1) {
              notifyDeclareMethod(declare_method_list_waiting[k]);
            }
            declare_method_list_waiting = [];
            // If Gadget Failed Notify Parent
            if (gadget_failed) {
              embedded_channel.notify({
                method: "failed",
                params: gadget_error
              });
              return;
            }
            connection_ready = true;
            notifyReady();
            //the channel is ok
            //so bind calls to renderJS method on the instance
            embedded_channel.bind("methodCall", function (trans, v) {
              root_gadget[v[0]].apply(root_gadget, v[1])
                .then(function (g) {
                  trans.complete(g);
                }).fail(function (e) {
                  trans.error(e.toString());
                });
              trans.delayReturn(true);
            });
          }
        });

        // Notify parent about gadget instanciation
        notifyReady = function () {
          if ((declare_method_count === 0) && (gadget_ready === true)) {
            embedded_channel.notify({method: "ready"});
          }
        };

        // Inform parent gadget about declareMethod calls here.
        notifyDeclareMethod = function (name) {
          declare_method_list_waiting.push(name);
        };

        notifyDeclareMethod("getInterfaceList");
        notifyDeclareMethod("getRequiredCSSList");
        notifyDeclareMethod("getRequiredJSList");
        notifyDeclareMethod("getPath");
        notifyDeclareMethod("getTitle");

        // Surcharge declareMethod to inform parent window
        TmpConstructor.declareMethod = function (name, callback) {
          var result = RenderJSGadget.declareMethod.apply(
              this,
              [name, callback]
            );
          notifyDeclareMethod(name);
          return result;
        };

        TmpConstructor.declareService =
          RenderJSGadget.declareService;
        TmpConstructor.declareJob =
          RenderJSGadget.declareJob;
        TmpConstructor.onEvent =
          RenderJSGadget.onEvent;
        TmpConstructor.declareAcquiredMethod =
          RenderJSGadget.declareAcquiredMethod;
        TmpConstructor.allowPublicAcquisition =
          RenderJSGadget.allowPublicAcquisition;

        iframe_top_gadget = true;
      }

      TmpConstructor.prototype.__acquired_method_dict = {};
      gadget_loading_klass_list.push(TmpConstructor);

      function init() {
        // XXX HTML properties can only be set when the DOM is fully loaded
        var settings = renderJS.parseGadgetHTMLDocument(document, url),
          j,
          key,
          fragment = document.createDocumentFragment();
        for (key in settings) {
          if (settings.hasOwnProperty(key)) {
            TmpConstructor.prototype['__' + key] = settings[key];
          }
        }
        TmpConstructor.__template_element = document.createElement("div");
        root_gadget.element = document.body;
        root_gadget.state = {};
        for (j = 0; j < root_gadget.element.childNodes.length; j += 1) {
          fragment.appendChild(
            root_gadget.element.childNodes[j].cloneNode(true)
          );
        }
        TmpConstructor.__template_element.appendChild(fragment);
        RSVP.all([root_gadget.getRequiredJSList(),
                  root_gadget.getRequiredCSSList()])
          .then(function (all_list) {
            var i,
              js_list = all_list[0],
              css_list = all_list[1];
            for (i = 0; i < js_list.length; i += 1) {
              javascript_registration_dict[js_list[i]] = null;
            }
            for (i = 0; i < css_list.length; i += 1) {
              stylesheet_registration_dict[css_list[i]] = null;
            }
            gadget_loading_klass_list.shift();
          }).then(function () {

            // select the target node
            var target = document.querySelector('body'),
              // create an observer instance
              observer = new MutationObserver(function (mutations) {
                var i, k, len, len2, node, added_list;
                mutations.forEach(function (mutation) {
                  if (mutation.type === 'childList') {

                    len = mutation.removedNodes.length;
                    for (i = 0; i < len; i += 1) {
                      node = mutation.removedNodes[i];
                      if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.hasAttribute("data-gadget-url") &&
                            (node._gadget !== undefined)) {
                          createMonitor(node._gadget);
                        }
                        added_list =
                          node.querySelectorAll("[data-gadget-url]");
                        len2 = added_list.length;
                        for (k = 0; k < len2; k += 1) {
                          node = added_list[k];
                          if (node._gadget !== undefined) {
                            createMonitor(node._gadget);
                          }
                        }
                      }
                    }

                    len = mutation.addedNodes.length;
                    for (i = 0; i < len; i += 1) {
                      node = mutation.addedNodes[i];
                      if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.hasAttribute("data-gadget-url") &&
                            (node._gadget !== undefined)) {
                          if (document.contains(node)) {
                            startService(node._gadget);
                          }
                        }
                        added_list =
                          node.querySelectorAll("[data-gadget-url]");
                        len2 = added_list.length;
                        for (k = 0; k < len2; k += 1) {
                          node = added_list[k];
                          if (document.contains(node)) {
                            if (node._gadget !== undefined) {
                              startService(node._gadget);
                            }
                          }
                        }
                      }
                    }

                  }
                });
              }),
              // configuration of the observer:
              config = {
                childList: true,
                subtree: true,
                attributes: false,
                characterData: false
              };

            // pass in the target node, as well as the observer options
            observer.observe(target, config);

            return root_gadget;
          }).then(resolve, function (e) {
            reject(e);
            console.error(e);
            throw e;
          });
      }
      document.addEventListener('DOMContentLoaded',
                                bootstrap_deferred_object.resolve, false);
      // Return Promies/Queue here instead of directly calling init()
      return new RSVP.Queue()
        .push(function () {
          return bootstrap_deferred_object.promise;
        })
        .push(function () {
          return init();
        });
    });

    loading_gadget_promise
      .push(function () {
        return loading_klass_promise;
      })
      .push(function (root_gadget) {
        var i;

        function ready_wrapper() {
          return root_gadget;
        }
        function ready_executable_wrapper(fct) {
          return function (g) {
            return fct.call(g, g);
          };
        }
        TmpConstructor.ready(function (g) {
          return startService(g);
        });

        loading_gadget_promise.push(ready_wrapper);
        for (i = 0; i < TmpConstructor.__ready_list.length; i += 1) {
          // Put a timeout?
          loading_gadget_promise
            .push(ready_executable_wrapper(TmpConstructor.__ready_list[i]))
            // Always return the gadget instance after ready function
            .push(ready_wrapper);
        }
      });
    if (window.self === window.top) {
      loading_gadget_promise
        .fail(function (e) {
          letsCrash(e);
          throw e;
        });
    } else {
      // Inform parent window that gadget is correctly loaded
      loading_gadget_promise
        .then(function () {
          gadget_ready = true;
          if (connection_ready) {
            notifyReady();
          }
        })
        .fail(function (e) {
          //top gadget in iframe
          if (iframe_top_gadget) {
            gadget_failed = true;
            gadget_error = e.toString();
            letsCrash(e);
          } else {
            embedded_channel.notify({method: "failed", params: e.toString()});
          }
          throw e;
        });
    }

  }
  bootstrap();

}(document, window, RSVP, DOMParser, Channel, MutationObserver, Node,
  FileReader, Blob, navigator, Event, URL));

/*! RenderJs */
/*jslint nomen: true*/

/*
 * renderJs - Generic Gadget library renderer.
 * http://www.renderjs.org/documentation
 */
(function (document, window, RSVP, DOMParser, Channel, MutationObserver,
           Node, FileReader, Blob, navigator, Event) {
  "use strict";

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

  var gadget_model_dict = {},
    javascript_registration_dict = {},
    stylesheet_registration_dict = {},
    gadget_loading_klass,
    loading_klass_promise,
    renderJS,
    Monitor,
    scope_increment = 0,
    isAbsoluteOrDataURL = new RegExp('^(?:[a-z]+:)?//|data:', 'i'),
    is_page_unloaded = false,
    error_list = [];

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
    var element_list = g.__element.querySelectorAll('[data-gadget-url]'),
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

  RenderJSGadget.__service_list = [];
  RenderJSGadget.declareService = function (callback) {
    this.__service_list.push(callback);
    return this;
  };

  function startService(gadget) {
    gadget.__monitor.monitor(new RSVP.Queue()
      .push(function () {
        var i,
          service_list = gadget.constructor.__service_list;
        for (i = 0; i < service_list.length; i += 1) {
          gadget.__monitor.monitor(service_list[i].apply(gadget));
        }
      })
      );
  }

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
      if (this.__element === undefined) {
        throw new Error("No element defined");
      }
      return this.__element;
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
  RenderJSEmbeddedGadget.declareService =
    RenderJSGadget.declareService;
  RenderJSEmbeddedGadget.prototype = new RenderJSGadget();
  RenderJSEmbeddedGadget.prototype.constructor = RenderJSEmbeddedGadget;

  /////////////////////////////////////////////////////////////////
  // privateDeclarePublicGadget
  /////////////////////////////////////////////////////////////////
  function privateDeclarePublicGadget(url, options, parent_gadget) {
    var gadget_instance;
    if (options.element === undefined) {
      options.element = document.createElement("div");
    }

    function loadDependency(method, url) {
      return function () {
        return method(url);
      };
    }

    return new RSVP.Queue()
      .push(function () {
        return renderJS.declareGadgetKlass(url);
      })
      // Get the gadget class and instanciate it
      .push(function (Klass) {
        var i,
          template_node_list = Klass.__template_element.body.childNodes;
        gadget_loading_klass = Klass;
        gadget_instance = new Klass();
        gadget_instance.__element = options.element;
        for (i = 0; i < template_node_list.length; i += 1) {
          gadget_instance.__element.appendChild(
            template_node_list[i].cloneNode(true)
          );
        }
        setAqParent(gadget_instance, parent_gadget);
        // Load dependencies if needed
        return RSVP.all([
          gadget_instance.getRequiredJSList(),
          gadget_instance.getRequiredCSSList()
        ]);
      })
      // Load all JS/CSS
      .push(function (all_list) {
        var q = new RSVP.Queue(),
          i;
        // Load JS
        for (i = 0; i < all_list[0].length; i += 1) {
          q.push(loadDependency(renderJS.declareJS, all_list[0][i]));
        }
        // Load CSS
        for (i = 0; i < all_list[1].length; i += 1) {
          q.push(loadDependency(renderJS.declareCSS, all_list[1][i]));
        }
        return q;
      })
      .push(function () {
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
  RenderJSIframeGadget.__service_list = RenderJSGadget.__service_list.slice();
  RenderJSIframeGadget.declareService =
    RenderJSGadget.declareService;
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
    gadget_instance.__element = options.element;
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
      var queue,
        parent_gadget = this,
        local_loading_klass_promise,
        previous_loading_klass_promise = loading_klass_promise;

      if (options === undefined) {
        options = {};
      }
      if (options.sandbox === undefined) {
        options.sandbox = "public";
      }

      // transform url to absolute url if it is relative
      url = renderJS.getAbsoluteURL(url, this.__path);
      // Change the global variable to update the loading queue
      loading_klass_promise = new RSVP.Queue()
        // Wait for previous gadget loading to finish first
        .push(function () {
          return previous_loading_klass_promise;
        })
        .push(undefined, function () {
          // Forget previous declareGadget error
          return;
        })
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
          // Drop the current loading klass info used by selector
          gadget_loading_klass = undefined;
          return gadget_instance;
        })
        .push(undefined, function (e) {
          // Drop the current loading klass info used by selector
          // even in case of error
          gadget_loading_klass = undefined;
          throw e;
        });
      local_loading_klass_promise = loading_klass_promise;

      queue = new RSVP.Queue()
        .push(function () {
          return local_loading_klass_promise;
        })
        // Set the HTML context
        .push(function (gadget_instance) {
          var i,
            scope;
          // Trigger calling of all ready callback
          function ready_wrapper() {
            return gadget_instance;
          }
          for (i = 0; i < gadget_instance.constructor.__ready_list.length;
               i += 1) {
            // Put a timeout?
            queue.push(gadget_instance.constructor.__ready_list[i]);
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
          gadget_instance.__element.setAttribute("data-gadget-scope",
                                                 scope);

          // Put some attribute to ease page layout comprehension
          gadget_instance.__element.setAttribute("data-gadget-url", url);
          gadget_instance.__element.setAttribute("data-gadget-sandbox",
                                                 options.sandbox);
          gadget_instance.__element._gadget = gadget_instance;

          if (document.contains(gadget_instance.__element)) {
            // Put a timeout
            queue.push(startService);
          }
          // Always return the gadget instance after ready function
          queue.push(ready_wrapper);

          return gadget_instance;
        });
      return queue;
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
      result = gadget_loading_klass;
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
    var doc, base, link,
      html = "<!doctype><html><head></head></html>";

    if (url && base_url && !isAbsoluteOrDataURL.test(url)) {
      doc = (new DOMParser()).parseFromString(html, 'text/html');
      base = doc.createElement('base');
      link = doc.createElement('link');
      doc.head.appendChild(base);
      doc.head.appendChild(link);
      base.href = base_url;
      link.href = url;
      return link.href;
    }
    return url;
  };

  /////////////////////////////////////////////////////////////////
  // renderJS.declareJS
  /////////////////////////////////////////////////////////////////
  renderJS.declareJS = function (url) {
    // Prevent infinite recursion if loading render.js
    // more than once
    var result;
    if (javascript_registration_dict.hasOwnProperty(url)) {
      result = RSVP.resolve();
    } else {
      result = new RSVP.Promise(function (resolve, reject) {
        var newScript;
        newScript = document.createElement('script');
        newScript.type = 'text/javascript';
        newScript.src = url;
        newScript.onload = function () {
          javascript_registration_dict[url] = null;
          resolve();
        };
        newScript.onerror = function (e) {
          reject(e);
        };
        document.head.appendChild(newScript);
      });
    }
    return result;
  };

  /////////////////////////////////////////////////////////////////
  // renderJS.declareCSS
  /////////////////////////////////////////////////////////////////
  renderJS.declareCSS = function (url) {
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
        document.head.appendChild(link);
      });
    }
    return result;
  };

  /////////////////////////////////////////////////////////////////
  // renderJS.declareGadgetKlass
  /////////////////////////////////////////////////////////////////
  renderJS.declareGadgetKlass = function (url) {
    var result;

    function parse(xhr) {
      var tmp_constructor,
        key,
        parsed_html;
      if (!gadget_model_dict.hasOwnProperty(url)) {
        // Class inheritance
        tmp_constructor = function () {
          RenderJSGadget.call(this);
        };
        tmp_constructor.__ready_list = RenderJSGadget.__ready_list.slice();
        tmp_constructor.__service_list = RenderJSGadget.__service_list.slice();
        tmp_constructor.declareMethod =
          RenderJSGadget.declareMethod;
        tmp_constructor.declareAcquiredMethod =
          RenderJSGadget.declareAcquiredMethod;
        tmp_constructor.allowPublicAcquisition =
          RenderJSGadget.allowPublicAcquisition;
        tmp_constructor.ready =
          RenderJSGadget.ready;
        tmp_constructor.declareService =
          RenderJSGadget.declareService;
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

        gadget_model_dict[url] = tmp_constructor;
      }

      return gadget_model_dict[url];
    }

    if (gadget_model_dict.hasOwnProperty(url)) {
      // Return klass object if it already exists
      result = RSVP.resolve(gadget_model_dict[url]);
    } else {
      // Fetch the HTML page and parse it
      result = new RSVP.Queue()
        .push(function () {
          return ajax(url);
        })
        .push(function (xhr) {
          return parse(xhr);
        });
    }
    return result;
  };

  /////////////////////////////////////////////////////////////////
  // renderJS.clearGadgetKlassList
  /////////////////////////////////////////////////////////////////
  // For test purpose only
  renderJS.clearGadgetKlassList = function () {
    gadget_model_dict = {};
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

  function bootstrap() {
    var url = removeHash(window.location.href),
      tmp_constructor,
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
    if (gadget_model_dict.hasOwnProperty(url)) {
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
        tmp_constructor = function () {
          RenderJSGadget.call(this);
        };
        tmp_constructor.declareMethod = RenderJSGadget.declareMethod;
        tmp_constructor.declareAcquiredMethod =
          RenderJSGadget.declareAcquiredMethod;
        tmp_constructor.allowPublicAcquisition =
          RenderJSGadget.allowPublicAcquisition;
        tmp_constructor.__ready_list = RenderJSGadget.__ready_list.slice();
        tmp_constructor.ready = RenderJSGadget.ready;
        tmp_constructor.__service_list = RenderJSGadget.__service_list.slice();
        tmp_constructor.declareService =
          RenderJSGadget.declareService;
        tmp_constructor.prototype = new RenderJSGadget();
        tmp_constructor.prototype.constructor = tmp_constructor;
        tmp_constructor.prototype.__path = url;
        gadget_model_dict[url] = tmp_constructor;

        // Create the root gadget instance and put it in the loading stack
        root_gadget = new gadget_model_dict[url]();

        setAqParent(root_gadget, last_acquisition_gadget);

      } else {
        // Create the root gadget instance and put it in the loading stack
        tmp_constructor = RenderJSEmbeddedGadget;
        tmp_constructor.__ready_list = RenderJSGadget.__ready_list.slice();
        tmp_constructor.__service_list = RenderJSGadget.__service_list.slice();
        tmp_constructor.prototype.__path = url;
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
              tmp_constructor.prototype.__aq_parent = function (method_name,
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
        tmp_constructor.declareMethod = function (name, callback) {
          var result = RenderJSGadget.declareMethod.apply(
              this,
              [name, callback]
            );
          notifyDeclareMethod(name);
          return result;
        };

        tmp_constructor.declareService =
          RenderJSGadget.declareService;
        tmp_constructor.declareAcquiredMethod =
          RenderJSGadget.declareAcquiredMethod;
        tmp_constructor.allowPublicAcquisition =
          RenderJSGadget.allowPublicAcquisition;

        iframe_top_gadget = true;
      }

      tmp_constructor.prototype.__acquired_method_dict = {};
      gadget_loading_klass = tmp_constructor;

      function init() {
        // XXX HTML properties can only be set when the DOM is fully loaded
        var settings = renderJS.parseGadgetHTMLDocument(document, url),
          j,
          key;
        for (key in settings) {
          if (settings.hasOwnProperty(key)) {
            tmp_constructor.prototype['__' + key] = settings[key];
          }
        }
        tmp_constructor.__template_element = document.createElement("div");
        root_gadget.__element = document.body;
        for (j = 0; j < root_gadget.__element.childNodes.length; j += 1) {
          tmp_constructor.__template_element.appendChild(
            root_gadget.__element.childNodes[j].cloneNode(true)
          );
        }
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
            gadget_loading_klass = undefined;
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
      document.addEventListener('DOMContentLoaded', init, false);
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

        tmp_constructor.ready(function (g) {
          return startService(g);
        });

        loading_gadget_promise.push(ready_wrapper);
        for (i = 0; i < tmp_constructor.__ready_list.length; i += 1) {
          // Put a timeout?
          loading_gadget_promise
            .push(tmp_constructor.__ready_list[i])
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
  FileReader, Blob, navigator, Event));

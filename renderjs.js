/*global console, require, $, localStorage, document */
"use strict";

/*
 * RenderJs - Generic Gadget library renderer.
 * http://www.renderjs.org/documentation
 */

// by default RenderJs will render all gadgets when page is loaded
// still it's possible to override this and use explicit gadget rendering
var RENDERJS_ENABLE_IMPLICIT_GADGET_RENDERING = true;

// by default RenderJs will examine and bind all interaction gadgets
// available 
var RENDERJS_ENABLE_IMPLICIT_INTERACTION_BIND = true;

// fallback for IE
if (typeof console === "undefined" || typeof console.log === "undefined") {
  console = {};
  console.log = function () {};
}

var RenderJs = (function () {
    // a variable indicating if current gadget loading is over or not
    var is_ready = false;

    return {

        init: function () {
          /*
           * Do all initialization
           */
          if (RENDERJS_ENABLE_IMPLICIT_GADGET_RENDERING) {
              RenderJs.bootstrap($('body'));
          }
          if (RENDERJS_ENABLE_IMPLICIT_INTERACTION_BIND) {
            var root_gadget = RenderJs.GadgetIndex.getRootGadget();
            // We might have a page without gadgets.
            // Be careful, right now we can be in this case because
            // asynchronous gadget loading is not finished
            if (root_gadget !== undefined) {
              RenderJs.bindReady(
                function () {
                  // examine all Intaction Gadgets and bind accordingly
                  $("div[data-gadget-connection]").each( function (index, element) {
                    RenderJs.InteractionGadget.bind($(element));
                  })
                });
            }
          };
        },

        bootstrap: function (root) {
            /*
             * Load all gadgets for this DOM element
             * (including recursively contained ones)
             */
            var gadget_id, is_gadget;
            gadget_id = root.attr("id");
            is_gadget = root.attr("data-gadget") !== undefined;
            // this will make RenderJs fire "ready" event when all gadgets are loaded.
            RenderJs.setReady(false);
            if (is_gadget && gadget_id !== undefined ) {
              // bootstart root gadget only if it is indeed a gadget
              RenderJs.loadGadget(root);
            }
            RenderJs.loadRecursiveGadget(root);
        },

        loadRecursiveGadget: function (root) {
            /*
             * Load all contained gadgets inside passed DOM element.
             */
            var gadget_list, gadget, gadget_id, gadget_js;
            gadget_list = root.find("[data-gadget]");

            // register all gadget in advance so checkAndTriggerReady
            // can have accurate information for list of all gadgets
            gadget_list.each(function () {
              gadget = $(this);
              gadget_id = gadget.attr("id");
              gadget_js = new RenderJs.Gadget(gadget_id, gadget);
              RenderJs.GadgetIndex.registerGadget(gadget_js);
            });

            // Load chilren
            gadget_list.each(function () {
                RenderJs.loadGadget($(this));
            });
        },

        setGadgetAndRecurse: function (gadget, data) {
            /*
             * Set gadget data and recursively load it in case it holds another
             * gadgets.
             */
            gadget.append(data);
            // a gadget may contain sub gadgets
            RenderJs.loadRecursiveGadget(gadget);
        },

        loadGadget: function (gadget) {
            /*
             * Load gadget's SPECs from URL
             */
            var url, gadget_id, gadget_property, cacheable, cache_id,
                app_cache, data, gadget_js, is_update_gadget_data_running;
            url = gadget.attr("data-gadget");
            gadget_id = gadget.attr("id");
            gadget_js = RenderJs.GadgetIndex.getGadgetById(gadget_id);
            if (gadget_js === undefined) {
              // register gadget in javascript namespace if not already registered
              gadget_js = new RenderJs.Gadget(gadget_id, gadget);
              RenderJs.GadgetIndex.registerGadget(gadget_js);
            }

            // update Gadget's instance with contents of "data-gadget-property"
            gadget_property = gadget.attr("data-gadget-property");
            if (gadget_property !== undefined) {
              gadget_property = $.parseJSON(gadget_property);
              $.each(gadget_property, function (key, value) {
                gadget_js[key] = value;
              });
            }

            if (url !== undefined && url !== "") {
                cacheable = gadget.attr("data-gadget-cacheable");
                cache_id = gadget.attr("data-gadget-cache-id");
                if (cacheable !== undefined && cache_id !== undefined) {
                    cacheable = Boolean(parseInt(cacheable, 10));
                }
                //cacheable = false ; // to develop faster
                if (cacheable) {
                    // get from cache if possible, use last part from URL as
                    // cache_key
                    app_cache = RenderJs.Cache.get(cache_id, undefined);
                    if (app_cache === undefined || app_cache === null) {
                        // not in cache so we pull from network and cache
                        $.ajax({
                            url: url,
                            yourCustomData: {
                                "gadget_id": gadget_id,
                                "cache_id": cache_id
                            },
                            success: function (data) {
                                cache_id = this.yourCustomData.cache_id;
                                gadget_id = this.yourCustomData.gadget_id;
                                RenderJs.Cache.set(cache_id, data);
                                RenderJs.GadgetIndex.getGadgetById(gadget_id).
                                    setReady();
                                RenderJs.setGadgetAndRecurse(gadget, data);
                                RenderJs.checkAndTriggerReady();
                            }
                        });
                    } else {
                        // get from cache
                        data = app_cache;
                        gadget_js.setReady();
                        this.setGadgetAndRecurse(gadget, data);
                        this.checkAndTriggerReady();
                    }
                } else {
                    // not to be cached
                    $.ajax({
                        url: url,
                        yourCustomData: {"gadget_id": gadget_id},
                        success: function (data) {
                            gadget_id = this.yourCustomData.gadget_id;
                            RenderJs.GadgetIndex.getGadgetById(gadget_id).
                                setReady();
                            RenderJs.setGadgetAndRecurse(gadget, data);
                            RenderJs.checkAndTriggerReady();
                        }
                    });
                }
            }
            else {
                // gadget is an inline (InteractorGadget or one using
                // data-gadget-source / data-gadget-handler) so no need
                // to load it from network
                is_update_gadget_data_running = RenderJs.updateGadgetData(gadget);
                if (!is_update_gadget_data_running) {
                  // no update is running so gadget is basically ready
                  // if update is running then it should take care and set status
                  gadget_js.setReady();
                }
                RenderJs.checkAndTriggerReady();
            }
        },

        isReady: function () {
            /*
             * Get rendering status
             */
            return is_ready;
        },

        setReady: function (value) {
            /*
             * Update rendering status
             */
            is_ready = value;
        },

        bindReady: function (ready_function) {
            /*
             * Bind a function on ready gadget loading.
             */
            $("body").one("ready", ready_function);
        },

        checkAndTriggerReady: function () {
            /*
             * Trigger "ready" event only if all gadgets were marked as "ready"
             */
            var is_gadget_list_loaded;
            is_gadget_list_loaded = RenderJs.GadgetIndex.isGadgetListLoaded();
            if (is_gadget_list_loaded) {
                if (!RenderJs.isReady()) {
                    // backwards compatability with already written code
                    RenderJs.GadgetIndex.getRootGadget().getDom().
                        trigger("ready");
                    // trigger ready on root body element
                    $("body").trigger("ready");
                    // this set will make sure we fire this event only once
                    RenderJs.setReady(true);
                }
            }
            return is_gadget_list_loaded;
        },

        updateGadgetData: function (gadget) {
            /*
             * Gadget can be updated from "data-gadget-source" (i.e. a json)
             * and "data-gadget-handler" attributes (i.e. a namespace Javascript) 
             */
            var data_source, data_handler;
            data_source = gadget.attr("data-gadget-source");
            data_handler = gadget.attr("data-gadget-handler");
            // acquire data and pass it to method handler
            if (data_source !== undefined && data_source !== "") {
                $.ajax({
                    url: data_source,
                    dataType: "json",
                    yourCustomData: {"data_handler": data_handler,
                                     "gadget_id": gadget.attr("id")},
                    success: function (result) {
                              var data_handler, gadget_id;
                              data_handler = this.yourCustomData.data_handler;
                              gadget_id = this.yourCustomData.gadget_id;
                              if (data_handler !== undefined) {
                                  // eval is not nice to use
                                  eval(data_handler + "(result)");
                                  gadget = RenderJs.GadgetIndex.getGadgetById(gadget_id);
                                  // mark gadget as loaded and fire a check
                                  // to see if all gadgets are loaded
                                  gadget.setReady();
                                  RenderJs.checkAndTriggerReady();
                              }
                             }
                });
                // asynchronous update happens and respective thread will update status
                return true;
            }
            return false;
        },

        addGadget: function (dom_id, gadget_id, gadget, gadget_data_handler,
                            gadget_data_source) {
            /*
             * add new gadget and render it
             */
            var html_string, tab_container, tab_gadget;
            tab_container = $('#' + dom_id);
            tab_container.empty();
            html_string = [
                '<div  id="' + gadget_id + '"',
                'data-gadget="' + gadget + '"',
                'data-gadget-handler="' + gadget_data_handler + '" ',
                'data-gadget-source="' + gadget_data_source + '"></div>'
            ].join('\n');

            tab_container.append(html_string);
            tab_gadget = tab_container.find(".gadget");

            // render new gadget
            RenderJs.bootstrap(tab_container);

            return tab_gadget;
        },

        Cache: (function () {
            /*
             * Generic cache implementation that can fall back to local
             * namespace storage if no "modern" storage like localStorage
             * is available
             */
            return {
                ROOT_CACHE_ID: 'APP_CACHE',

                getCacheId: function (cache_id) {
                    /*
                     * We should have a way to 'purge' localStorage by setting a
                     * ROOT_CACHE_ID in all browser instances
                     */
                    return this.ROOT_CACHE_ID + cache_id;
                },

                hasLocalStorage: function () {
                    /*
                     * Feature test if localStorage is supported
                     */
                    var mod;
                    mod = 'localstorage_test_12345678';
                    try {
                        localStorage.setItem(mod, mod);
                        localStorage.removeItem(mod);
                        return true;
                    } catch (e) {
                        return false;
                    }
                },

                get: function (cache_id, default_value) {
                    /* Get cache key value */
                    cache_id = this.getCacheId(cache_id);
                    if (this.hasLocalStorage()) {
                        return this.LocalStorageCachePlugin.
                            get(cache_id, default_value);
                    }
                    //fallback to javscript namespace cache
                    return this.NameSpaceStorageCachePlugin.
                        get(cache_id, default_value);
                },

                set: function (cache_id, data) {
                    /* Set cache key value */
                    cache_id = this.getCacheId(cache_id);
                    if (this.hasLocalStorage()) {
                        this.LocalStorageCachePlugin.set(cache_id, data);
                    } else {
                        this.NameSpaceStorageCachePlugin.set(cache_id, data);
                    }
                },

                LocalStorageCachePlugin: (function () {
                    /*
                     * This plugin saves using HTML5 localStorage.
                     */
                    return {
                        get: function (cache_id, default_value) {
                            /* Get cache key value */
                            if (cache_id in localStorage) {
                              return JSON.parse(localStorage.getItem(cache_id));
                            }
                            else {
                              return default_value;
                            }
                        },

                        set: function (cache_id, data) {
                            /* Set cache key value */
                            localStorage.setItem(cache_id, JSON.stringify(data));
                        }
                    };
                }()),

                NameSpaceStorageCachePlugin: (function () {
                    /*
                     * This plugin saves within current page namespace.
                     */
                    var namespace = {};

                    return {
                        get: function (cache_id, default_value) {
                            /* Get cache key value */
                            return namespace[cache_id];
                        },

                        set: function (cache_id, data) {
                            /* Set cache key value */
                            namespace[cache_id] = data;
                        }
                    };
                }())
            };
        }()),

        Gadget: (function (gadget_id, dom) {
            /*
             * Javascript Gadget representation
             */
            this.id = gadget_id;
            this.dom = dom;
            this.is_ready = false;

            this.getId = function () {
                return this.id;
            };

            this.getDom = function () {
                return this.dom;
            };

            this.isReady = function () {
                /*
                 * Return True if remote gadget is loaded into DOM.
                 */
                return this.is_ready;
            };

            this.setReady = function () {
                /*
                 * Return True if remote gadget is loaded into DOM.
                 */
                this.is_ready = true;
            };

            this.remove = function () {
                /*
                 * Remove gadget (including its DOM element).
                 */
                // unregister from GadgetIndex
                RenderJs.GadgetIndex.unregisterGadget(this);
                // remove its DOM element
                $(this.getDom()).remove();
            };
        }),

        TabbularGadget: (function () {
            /*
             * Generic tabular gadget
             */
            return {
                toggleVisibility: function (visible_dom) {
                    /*
                     * Set tab as active visually and mark as not active rest.
                     */
                    $(".selected").addClass("not_selected");
                    $(".selected").removeClass("selected");
                    visible_dom.addClass("selected");
                    visible_dom.removeClass("not_selected");
                },

                addNewTabGadget: function (dom_id, gadget, gadget_data_handler,
                                          gadget_data_source) {
                    /*
                     * add new gadget and render it
                     */
                    var tab_gadget;
                    tab_gadget = RenderJs.addGadget(
                        dom_id, gadget, gadget_data_handler, gadget_data_source
                    );
                    // XXX: we should unregister all gadgets (if any we replace now in DOM)
                }
            };
        }()),

        GadgetIndex: (function () {
            /*
             * Generic gadget index placeholder
             */
            var gadget_list = [];

            return {

                getGadgetIdListFromDom: function (dom) {
                  /*
                   * Get list of all gadget's ID from DOM
                   */
                  var gadget_id_list = [];
                  $.each(dom.find('[data-gadget]'),
                         function (index, value) {
                           gadget_id_list.push($(value).attr("id"));}
                    );
                  return gadget_id_list;
                },

                setGadgetList: function (gadget_list_value) {
                    /*
                     * Set list of registered gadgets
                     */
                    gadget_list = gadget_list_value;
                },

                getGadgetList: function () {
                    /*
                     * Return list of registered gadgets
                     */
                    return gadget_list;
                },

                registerGadget: function (gadget) {
                    /*
                     * Register gadget
                     */
                    gadget_list.push(gadget);
                },

                unregisterGadget: function (gadget) {
                    /*
                     * Unregister gadget
                     */
                    var index = $.inArray(gadget, gadget_list);
                    if (index !== -1) {
                        gadget_list.splice(index, 1);
                    }
                },

                getGadgetById: function (gadget_id) {
                    /*
                     * Get gadget javascript representation by its Id
                     */
                    var gadget;
                    gadget = undefined;
                    $(RenderJs.GadgetIndex.getGadgetList()).each(
                        function (index, value) {
                            if (value.getId() === gadget_id) {
                                gadget = value;
                            }
                        }
                    );
                    return gadget;
                },

                getRootGadget: function () {
                    /*
                     * Return root gadget (always first one in list)
                     */
                    return this.getGadgetList()[0];
                },

                isGadgetListLoaded: function () {
                    /*
                     * Return True if all gadgets were loaded from network or
                     * cache
                     */
                    var result;
                    result = true;
                    $(this.getGadgetList()).each(
                        function (index, value) {
                            if (value.isReady() === false) {
                                result = false;
                            }
                        }
                    );
                    return result;
                }
            };
        }()),

        GadgetCatalog : (function () {
            /*
             * Gadget catalog provides API to get list of gadgets from a repository
             */
            return {
                updateGadgetIndexFromURL: function (url) {
                  /*
                   * Update gadget index from a remote repository.
                   */
                },

                setGadgetIndexUrlList: function (url_list) {
                  /*
                   * Set list of Gadget Index repositories.
                   */
                  // store in Cache (html5 storage)
                  var cache_id = "setGadgetIndexUrlList";
                  RenderJs.Cache.set(cache_id, url_list)
                },

                getGadgetIndexUrlList: function () {
                  /*
                   * Get list of Gadget Index repositories.
                   */
                  // get from Cache (html5 storage)
                  var cache_id = "setGadgetIndexUrlList";
                  return RenderJs.Cache.get(cache_id, undefined)
                },

                getGadgetListThatProvide: function (service_list) {
                  /*
                   * Return list of all gadgets that providen a given service.
                   * Read this list from data structure created in HTML5 local
                   * storage by updateGadgetIndexFromURL
                   */
                  // XXX: get from Cache stored index and itterate over it
                  // to find matching ones
                },

                registerServiceList: function (gadget, service_list) {
                  /*
                   * Register a service provided by a gadget.
                   */
                },
            };
        }()),

        InteractionGadget : (function () {
            /*
             * Basic gadget interaction gadget implementation.
             */
            return {
                bind: function (gadget_dom) {
                    /*
                     * Bind event between gadgets.
                     */
                    var gadget_id, gadget_connection_list, 
                      createMethodInteraction = function (
                        original_source_method_id, source_gadget_id,
                        source_method_id, destination_gadget_id,
                        destination_method_id) {
                        var interaction = function () {
                            // execute source method
                            RenderJs.GadgetIndex.getGadgetById(
                                source_gadget_id)[original_source_method_id].
                                apply(null, arguments);
                            // call trigger so bind can be asynchronously called
                            RenderJs.GadgetIndex.getGadgetById(
                                destination_gadget_id).dom.trigger(source_method_id);
                        };
                        return interaction;
                    },
                    createTriggerInteraction = function (
                        destination_gadget_id, destination_method_id) {
                        var interaction = function () {
                            RenderJs.GadgetIndex.getGadgetById(
                                destination_gadget_id)[destination_method_id].
                                apply(null, arguments);
                        };
                        return interaction;
                    };
                    gadget_id = gadget_dom.attr("id");
                    gadget_connection_list = gadget_dom.attr("data-gadget-connection");
                    gadget_connection_list = $.parseJSON(gadget_connection_list);
                    $.each(gadget_connection_list, function (key, value) {
                        var source, source_gadget_id, source_method_id,
                        source_gadget, destination, destination_gadget_id,
                        destination_method_id, destination_gadget,
                        original_source_method_id;
                        source = value.source.split(".");
                        source_gadget_id = source[0];
                        source_method_id = source[1];
                        source_gadget = RenderJs.GadgetIndex.
                            getGadgetById(source_gadget_id);

                        destination = value.destination.split(".");
                        destination_gadget_id = destination[0];
                        destination_method_id = destination[1];
                        destination_gadget = RenderJs.GadgetIndex.
                            getGadgetById(destination_gadget_id);

                        if (source_gadget.hasOwnProperty(source_method_id)) {
                            // direct javascript use case
                            original_source_method_id = "original_" +
                                source_method_id;
                            source_gadget[original_source_method_id] =
                                source_gadget[source_method_id];
                            source_gadget[source_method_id] =
                                createMethodInteraction(
                                    original_source_method_id,
                                    source_gadget_id,
                                    source_method_id,
                                    destination_gadget_id,
                                    destination_method_id
                                );
                            // we use html custom events for asyncronous method call so
                            // bind destination_gadget to respective event
                            destination_gadget.dom.bind(
                                source_method_id,
                                createTriggerInteraction(
                                    destination_gadget_id, destination_method_id
                                )
                            );
                        }
                        else {
                            // this is a custom event attached to HTML gadget
                            // representation
                            source_gadget.dom.bind(
                                source_method_id,
                                createTriggerInteraction(
                                    destination_gadget_id, destination_method_id
                                )
                            );
                        }
                    });
                }
            };
        }())
    };
}());

// impliticly call RenderJs bootstrap
//  $(document).ready(function () {
//      RenderJs.init();
//  });

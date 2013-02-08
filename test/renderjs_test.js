/*
 * RenderJs tests
 */

// in tests we need to call function manually rather than rely
// on implicit calling
RENDERJS_ENABLE_IMPLICIT_INTERACTION_BIND=false;

function cleanUp () {
  /*
   * Clean up namespace between tests
   */
  // re-init GadgetIndex
  RenderJs.GadgetIndex.setGadgetList([]);
  equal(0, RenderJs.GadgetIndex.getGadgetList().length);
}

// used by tests namespace variables
counter = 0;
first_name=''
last_name=''
function parseJSONAndUpdateNameSpace(result) {
  first_name=result['first_name'];
  last_name=result['last_name'];
}

function makeid() {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for( var i=0; i < 5; i++ )
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

function setupRenderJSTest(){
  /*
  * Main RenderJS test entry point
  */
  module("Cache");
  test('Cache', function () {
    cache_id = 'my_test';
    data = {'gg':1};
    RenderJs.Cache.set(cache_id, data);
    deepEqual(data, RenderJs.Cache.get(cache_id));
    // test return default value if key is missing works
    equal("no such key", RenderJs.Cache.get("no_such_key", "no such key"));
  });

  module("GadgetIndex");
  test('GadgetIndex', function () {
    cleanUp();
    $("#qunit-fixture").append('<div data-gadget="loading/test-gadget.html" id="new">X</div>');
    RenderJs.bootstrap($("#qunit-fixture"));
    stop();

    RenderJs.bindReady(function (){
      start();
      equal(RenderJs.GadgetIndex.getGadgetList().length, 1);
      equal(true, RenderJs.GadgetIndex.isGadgetListLoaded());
      equal("new", RenderJs.GadgetIndex.getRootGadget().getDom().attr("id"));
      equal(RenderJs.GadgetIndex.getGadgetById("new"), RenderJs.GadgetIndex.getRootGadget());
      dom = $("#qunit-fixture");
      deepEqual(["new"], RenderJs.GadgetIndex.getGadgetIdListFromDom(dom));

      // try register gadget twice and check it's registered once only
      RenderJs.GadgetIndex.registerGadget(RenderJs.GadgetIndex.getGadgetById("new"));

      // test unregister gadget
      equal(RenderJs.GadgetIndex.getGadgetList().length, 1);
      equal(RenderJs.GadgetIndex.getGadgetById("new"), RenderJs.GadgetIndex.getRootGadget());
      RenderJs.GadgetIndex.unregisterGadget(RenderJs.GadgetIndex.getGadgetById("new"));
      equal(RenderJs.GadgetIndex.getGadgetList().length, 0); 
    });

   });

  module("GadgetObject");
  test('GadgetObject', function () {
    cleanUp();
    $("#qunit-fixture").append('<div data-gadget="loading/test-gadget.html" id="new-gadget">X</div>');
    RenderJs.bootstrap($("#qunit-fixture"));
    stop();

    RenderJs.bindReady(function (){
      start();
      equal(RenderJs.GadgetIndex.getGadgetList().length, 1);
      root_gadget = RenderJs.GadgetIndex.getRootGadget();
      equal("new-gadget", root_gadget.getDom().attr("id"));

      // test remove gadget
      root_gadget.remove();
      equal(RenderJs.GadgetIndex.getGadgetList().length, 0);
      equal(0, $("#new-gadget").length);
    });
   });

  module("addGadget");
  test('addGadget', function () {
    cleanUp();
    equal(RenderJs.GadgetIndex.getGadgetList().length, 0);
    RenderJs.addGadget("qunit-fixture", "new_added", "loading/test-gadget.html", "", "");
    stop();

    RenderJs.bindReady(function (){
      start();
      equal($("#qunit-fixture").children("#new_added").length, 1);
      equal(RenderJs.GadgetIndex.getGadgetList().length, 1);
      equal(RenderJs.GadgetIndex.getRootGadget().getDom().attr("id"), "new_added");
    });
   });

  module("TabularGadget");
  test('addTabularGadget', function () {
    cleanUp();
    equal(RenderJs.GadgetIndex.getGadgetList().length, 0);
    RenderJs.TabbularGadget.addNewTabGadget("qunit-fixture", "new_added", "loading/test-gadget.html", "", "");
    stop();

    RenderJs.bindReady(function (){
      start();
      equal($("#qunit-fixture").children("#new_added").length, 1);
      equal(RenderJs.GadgetIndex.getGadgetList().length, 1);
      equal(RenderJs.GadgetIndex.getRootGadget().getDom().attr("id"), "new_added");
    });
   });

  module("GadgetInitialization");
  test('GadgetInitialization', function () {
    cleanUp();
    $("#qunit-fixture").append('<div data-gadget="" id="new-init" data-gadget-property="{&quot;name&quot;: &quot;Ivan&quot;, &quot;age&quot;: 33}">X</div>');
    RenderJs.bootstrap($("#qunit-fixture"));

    // test that gadget get a proper initialization from data-gadget-property
    equal('Ivan', RenderJs.GadgetIndex.getGadgetById("new-init").name);
    equal(33, RenderJs.GadgetIndex.getGadgetById("new-init").age);
  });


  module("GadgetReadyEvent");
  test('GadgetReadyEvent', function () {
    cleanUp();
    RenderJs.addGadget("qunit-fixture", "new_added", "interactions/index.html", "", "");
    stop();

    // we need to wait for all gadgets loading ...
    RenderJs.bindReady(function () {
      start();
      equal(true, RenderJs.GadgetIndex.isGadgetListLoaded());
    });
   });

  module("InteractionGadget");
  test('InteractionGadget', function () {
    cleanUp();
    RenderJs.addGadget("qunit-fixture", "new_add", "interactions/index.html", "", "");
    stop();

    // we need to wait for all gadgets loading ...
    RenderJs.bindReady(function () {
      RenderJs.InteractionGadget.bind($("#main-interactor"));
      start();
      equal(0, counter);
      // A.inc will call B.inc, both will increase counter by 1
      RenderJs.GadgetIndex.getGadgetById("A").inc();
      equal(2, counter);
      // fire pure HTML event on A and test it calls respective B method
      $('#A').trigger('htmlEvent1');
      equal(3, counter);
      // fire pure HTML event that calls multiple destinations methods
      // On its side these methods themself can call each other like now
      // when A.inc calls B.inc thus result is 6 NOT 5!
      $('#main-interactor').trigger('multiEvent');
      equal(6, counter);
    });
   });

  module("GadgetDataHandler");
  test('GadgetDataHandler', function () {
    cleanUp();
    $("#qunit-fixture").append('<div data-gadget="" id="json-gadget" data-gadget-source = "json/json_file.json" data-gadget-handler="parseJSONAndUpdateNameSpace"></div>');
    RenderJs.bootstrap($("#qunit-fixture"));
    equal('', first_name);
    equal('', last_name);
    stop();

    // we need to wait for all gadgets loading ...
    RenderJs.bindReady(function () {
      start();
      equal('John', first_name);
      equal('Doh', last_name);
    });
  });

  module("GadgetCatalog");
  test('GadgetCatalog', function () {
    cleanUp();
    // allow test to be run alone (i.e. url contains arguments)
    var base_url = window.location.protocol + "//" + window.location.hostname + window.location.pathname;
    // generate random argument to test always with new cache id
    var url_list = new Array(base_url + '/gadget_index/gadget_index.json?t='+makeid());

    RenderJs.GadgetCatalog.setGadgetIndexUrlList(url_list)
    deepEqual(url_list, RenderJs.GadgetCatalog.getGadgetIndexUrlList());
    RenderJs.GadgetCatalog.updateGadgetIndex();
    stop();

    // XXX: until we have a way to know that update which runs asynchronously is over
    // we use hard coded timeouts.
    setTimeout(function(){
      start();
      cached = RenderJs.Cache.get(url_list[0]);
      equal("HTML WYSIWYG", cached["gadget_list"][0]["title"]);
      deepEqual(["edit_html", "view_html"], cached["gadget_list"][0]["service_list"]);

      // check that we can find gadgets that provide some service_list
      gadget_list = RenderJs.GadgetCatalog.getGadgetListThatProvide("edit_html");
      equal("HTML WYSIWYG", gadget_list[0]["title"]);
      deepEqual(["edit_html", "view_html"], gadget_list[0]["service_list"]);
      gadget_list = RenderJs.GadgetCatalog.getGadgetListThatProvide("view_html");
      equal("HTML WYSIWYG", gadget_list[0]["title"]);
      deepEqual(["edit_html", "view_html"], gadget_list[0]["service_list"]);

      gadget_list = RenderJs.GadgetCatalog.getGadgetListThatProvide("edit_svg");
      equal("SVG WYSIWYG", gadget_list[0]["title"]);
      deepEqual(["edit_svg", "view_svg"], gadget_list[0]["service_list"]);

      // no such service is provided by gadget repos
      equal(0, RenderJs.GadgetCatalog.getGadgetListThatProvide("edit_html1"));

    }, 3000)


  });

};


/*global document, jQuery */
(function (document, $) {
  "use strict";

  var setup = function () {
    renderJs.mapUrl(window.location.search, function (value, textStatus, jqXHR) {

      var scope = value._links.scope.href.slice(0,-1).split(/[/]+/).pop(),
        register = value._links.call.href
          .replace("{method}", "register")
          .replace("{scope}", scope )
          .replace("{interaction}", ""),
        service = {
          "type": "register/any",
          "src": encodeURIComponent(window.location.href),
          "rel": "browse",
          "self": window.frameElement.id
        };

      $.ajax({
        method: 'POST',
        url: register,
        context: $(this),
        data: JSON.stringify(service),
        error: function (jqXHR, textStatus, errorThrown) {
          console.log("registration failed: " + errorThrown);
        },
        success: function (value, textStatus, jqXHR) {
          // console.log("registration successful");
        }
      });

      // HACK: this is hacking the functionality provided by the
      // filebrowser!
      // 'browser://call/browse/' should be called by the interactor
      // instead of hardcoding it here
      $.ajax({
        method: 'GET',
        url: value._links.scope.href,
        context: $('body'),
        error: function (jqXHR, textStatus, errorThrown) {
          $(this).text(errorThrown);
        },
        success: function (value2, textStatus, jqXHR) {
          var content_type = jqXHR.getResponseHeader("Content-Type") || "",
            request = value._links.call.href
              .replace("{method}", "request")
              .replace("{scope}", scope )
              .replace("{interaction}", "preview");

          // XXX Hardcoded mime type
          if (content_type.split(';')[0] === "application/hal+json") {
            // XXX Will fail if response does not send expected links...
            $(this).html("<ul>");
            for (var i in value2._links.contents){
                $(this).append("<li><button id='" + i + "'>" +
                  value2._links.contents[i].href + "</button></li>");

                $(this).find("#" + i.toString()).on('click', function(e, target) {

                  $.ajax({
                    method: "POST",
                    url: request,
                    context: $(this),
                    data: $(this).text(),
                    error: function (jqXHR, textStatus, errorThrown) {
                      console.log("request failed: " + errorThrown);
                    },
                    success: function (value, textStatus, jqXHR) {
                      console.log("request sent");
                    }
                  });
                });
            }
            $(this).append("</ul>");
          } else {
            $(this).text("Unsupported content type " + content_type);
          };
        }
      });
    });
  };

  $(document).ready(function () {
    setup();
  });

}(document, jQuery));

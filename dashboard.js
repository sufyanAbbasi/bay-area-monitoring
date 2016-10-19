  "use strict";
  jQuery.support.cors = true;
  var zoomify, locationDivId, timelapse, timelapseFeedUnavailable, hashVars, dateAxis, dateAxisListener, playInterval;
  var pageLoadDate = cached_breathecam.latest.date;
  var today = new Date();
  cached_breathecam.latest.date = today.toISOString().substring(0,10);
  var esdr_feeds = {};
  var series = [];
  var loadedSeries = [];
  var seriesIdx = 0;
  var plotManager;
  var area = {};
  var currentLocation = "shenango1";
  var currentDate;
  var ESDR_API_ROOT_URL = 'http://esdr.cmucreatelab.org/api/v1';
  var TILE_BOUNDARY_SENTINEL_VALUE = -1e+308;
  var fixedCursorPosition;
  var grapherReady = false;
  var tmReady = false;
  var grapherLoadedInterval = null;
  var showSmokeDetection = false;
  var playSpeed = 10;

  var feedMap = {
    "Atchison Village" : [4910, 4909],
    "North Richmond" : [4911, 4912],
    "Point Richmond" : [4913, 4914],
    "North Rodeo" : [4902, 4903],
    "South Rodeo" : [4901, 4903]
  };

  var healthLimitMap = {
    "Benzene (ppb)" : 1,
    "Black Carbon (ppb)": 3.5,
    "Hydrogen Sulfide (ppb)": 8,
    "Sulfur Dioxide (ppb)": 75,
    "Toluene (ppb)": 70,
    "Xylene (ppb)": 50,
    "Ethylbenzene (ppb)": 60
  };

  var communityDetectionLimitMap = {
    "Benzene (ppb)" : 0.5,
    "Hydrogen Sulfide (ppb)": 2,
    "Toluene (ppb)": 0.5,
    "Xylene (ppb)": 0.5,
    "Ethylbenzene (ppb)": 0.5,
    "Black Carbon (ppb)": 0.05
  };

  var refineryDetectionLimitMap = {
    "Benzene (ppb)" : 5,
    "Hydrogen Sulfide (ppb)": 30,
    "Sulfur Dioxide (ppb)": 5,
    "Toluene (ppb)": 5,
    "Xylene (ppb)": 5
  };

  if (showSmokeDetection) {
    esdr_feeds.Smoke_Detection = {
      feed_id: 5494,
      requested_day: {},
      api_key: "22075ad630b1f674e7f1da7f3de77b5abeea89f95e9c6c8868eef6cf0cd312b1",
      channels: {
        smoke_level : {
          show_graph: true,
          graphMetaData : {
            label: "Smoke Detection",
            color: "93,93,93"
          },
          summary: {}
        }
      },
      fullTimeRange: {}
    };
  }

  function selectArea(targetArea, locale) {
    area.id = targetArea;
    if(!locale && targetArea === "richmond") {
      area.locale = "Atchison Village";
    }
    else if (!locale && targetArea === "crockett-rodeo") {
      area.locale = "North Rodeo";
    }
    else {
      area.locale = locale;
    }
  }

  function changeLocale(targetArea, locale) {
    selectArea(targetArea, locale);
    refreshChannelPage();
  }

  function refreshChannelPage() {
    esdr_feeds = {};
    plotManager.getDateAxis().removeAxisChangeListener(dateAxisListener);
    plotManager.removeAllPlotContainers();
    $("#grapher > tbody > tr").not("tr:first").remove();
    series = [];
    loadedSeries = [];
    $("#auto_scale_toggle_button").removeClass("toggle-button-off");
    $("#play").off();
    playSpeed = 10;
    $("#zoomGrapherOut").off();
    $("#zoomGrapherIn").off();
    channelPageSetup();
  }

  function tm_init() {
    selectTimelapseFeed();

    var initialDataset = cached_breathecam.latest.path;
    var startingDate = cached_breathecam.latest.date;

    var hash = window.location.hash.slice(1);
    hashVars = org.gigapan.Util.unpackVars(hash);

    var loadedTimelapse = false;
    if (hashVars) {
      if (hashVars.d) {
        startingDate = String(hashVars.d);
        initialDataset = cached_breathecam.datasets[startingDate];
        if (!initialDataset) {
          initialDataset = cached_breathecam.latest.path;
        }
      }
      if (hashVars.s) {
        loadedTimelapse = true;
        currentLocation = String(hashVars.s);
        changeLocation(currentLocation, startingDate, null, null, false, function() {
          initialDataset = cached_breathecam.datasets[startingDate];
          if (!initialDataset) {
            initialDataset = cached_breathecam.latest.path;
          }
          setupTimelapse(initialDataset, startingDate);
        });
      }
    }

    // If we did not load the timelapse with the hash vars above, do so now.
    if (!loadedTimelapse)
      setupTimelapse(initialDataset, startingDate);
  }

  function img_init() {
    zoomify = new org.gigapan.zoomify({
      onImageReady: function(imgId) {
        showContent();
        if (!$("#timelapse_feed").is(':visible')) {
          selectImageFeed();
        }
      }
    });

    $("#stitched_image").load(function() {
      zoomify.makeImageZoomable("stitched_image");
    });

    $("#stitched_image").bind("mouseover mouseup", function() {
      $(this).removeClass("openHand closedHand").addClass("openHand");
    }).bind("mousedown", function() {
      $(this).removeClass("openHand closedHand").addClass("closedHand");
    });
  }

  function play() {
    var currentTime = plotManager.getDateAxis().getCursorPosition();
    plotManager.getDateAxis().setCursorPosition(currentTime + playSpeed);
    playInterval = window.requestAnim(play);
  };

  function pause() {
    window.cancelAnimationFrame(playInterval);
  }

  function setupTimelapse(initialDataset, startingDate) {
    var settings = {
      url: initialDataset,
      disableTourLooping: true,
      mediaType: ".mp4",
      showFullScreenBtn: false,
      showLogoOnDefaultUI: false,
      datasetType: "breathecam",
      showThumbnailTool: true,
      enableTimelineMetadataVisualizer: true,
      onTimeMachinePlayerReady: function(viewerDivId) {
        tmReady = true;
        createTutorialButton(720, 540, "#timeMachine");
        if (canvasLayer)
          repaintCanvasLayer();
        if (smellCanvasLayer)
          repaintSmellCanvasLayer();
        // Time Machine Listeners
        timelapse.addTimeChangeListener(function(videoTime) {
          if (dateAxis) {
            fixedCursorPosition = Date.parse(timelapse.getCurrentCaptureTime().replace(/-/g, "/")) / 1000;
            dateAxis.setCursorPosition(fixedCursorPosition);
          }
          if (canvasLayer)
            repaintCanvasLayer();
          if (smellCanvasLayer)
            repaintSmellCanvasLayer();
        });
        // Override the hashchange event
        window.onhashchange = null;
        $(window).on("hashchange", function() {
          var newHash = window.location.hash.slice(1);
          var newHashVars = org.gigapan.Util.unpackVars(newHash);
          var currentHash = timelapse.getShareView();
          var currentHashVars = org.gigapan.Util.unpackVars(currentHash);
          window.location.hash = "";

          if (!newHashVars) return;

          if ((newHashVars.d && currentHashVars.d != newHashVars.d) || (newHashVars.s && currentHashVars.s != newHashVars.s)) {
            var newDate, newDataset;
            if (newHashVars.d) {
              newDate = String(newHashVars.d);
              newDataset = cached_breathecam.datasets[newDate];
              if (!newDataset) return;
            }
            var newTime = parseFloat(newHashVars.t);
            var newView = timelapse.normalizeView(timelapse.unsafeViewToView(newHashVars.v));
            if (newHashVars.s && currentHashVars.s != newHashVars.s) {
              currentLocation = String(newHashVars.s);
              changeLocation(currentLocation, newDate, newView, newTime, true);
            } else {
              updateCalendarAndToggleUI(newDate);
              timelapse.loadTimelapse(newDataset, newView, newTime, false);
            }
          } else {
            // Share views
            timelapse.loadSharedViewFromUnsafeURL("#" + newHash);
          }
        });
        if (!hashVars) {
          var numFrames = timelapse.getNumFrames();
          // 12 fps * 5 seconds = 60 frames
          var fiveSecondsFromEnd = numFrames - 60;
          timelapse.seekToFrame(fiveSecondsFromEnd);
        }
        showContent();
        // Share view
        var hash = window.location.hash.slice(1);
        timelapse.loadSharedViewFromUnsafeURL("#" + hash);
        $("#timeMachine").hide();
        $("#locationTitle").hide();
        //$("#container").html("<div class='timelapse_hide'>Camera feed coming soon!</div>");
      }
    };
    timelapse = new org.gigapan.timelapse.Timelapse("timeMachine", settings);

    loadCalendar(startingDate);
  }

  function hideSmokeDetectionGraph() {
    $('*[data-channel="smoke_level"]').hide();
    setSizes();
  }

  function showSmokeDetectionGraph() {
    $('*[data-channel="smoke_level"]').show();
    setSizes();
  }

  function moveTimelineMetadataVisualizerUI() {
    var $target = $('*[data-channel="smoke_level"]').find('div')[0];
    $(".fastforwardButton").appendTo($target).css({
      "position" : "relative",
      "margin-top" : "2px"
    });
    $(".metadataImgsButton").appendTo($target).css({
      "position" : "relative",
      "margin-left" : "5px",
      "margin-top" : "2px"
    });
  }

  function loadMetaData(date, datasetName) {
    $.ajax({
      dataType: "json",
      url: "http://tiles.cmucreatelab.org/ecam/timemachines/smoke_detection/" + datasetName + "/smoke-" + date + ".json",
      success: function(json) {
        moveTimelineMetadataVisualizerUI();
        timelapse.getTimelineMetadataVisualizer().loadMetaData(json);
        timelapse.getTimelineMetadataVisualizer().showControlUI();
        showSmokeDetectionGraph();
      },
      error: function() {
        //timelapse.getTimelineMetadataVisualizer().hideControlUI();
        hideSmokeDetectionGraph();
      }
    });
  }

  function selectTimelapseFeed() {
    $("#image_feed").css("visibility", "hidden");
    $("#stitched_image_wrapper").css("visibility", "hidden");
    $("#stitched_image").css("visibility", "hidden");
    $("#timelapse_feed").show();
    setLocationTitle();
  }

  function selectImageFeed() {
    $("#timelapse_feed").hide();
    $("#image_feed").css("visibility", "visible");
    $("#stitched_image_wrapper").css("visibility", "visible");
    $("#stitched_image").css("visibilriity", "visible");
    $("#location_toggle_container").css("top", "0px");
    setLocationTitle();
  }

  function setLocationTitle() {
    var locationTitle = $("#location_toggle_container .location_thumbnail_selected").siblings(".location_title").text();
    $("#locationTitle").text(locationTitle);
  }

  function showContent() {
    $("#loading").hide();
    $("#content").css("visibility", "visible");
  }

  function changeLocation(locationName, newDate, newView, newTime, doLoad, callBack, newTimeAsDateObj) {
    currentLocation = locationName;
    if (timelapseFeedUnavailable) {
      location.href = "/embeds/" + locationName;
    } else {
      $.ajax({
        url: "http://tiles.cmucreatelab.org/ecam/timemachines/" + locationName + "/" + locationName + ".json",
        dataType: "json"
      }).done(function(data) {
        cached_breathecam = data;
        var startingDate = cached_breathecam.latest.date;
        var startingDataset = cached_breathecam.latest.path;

        if (newDate) {
          var tmpStartingDataset = cached_breathecam.datasets[newDate];
          if (tmpStartingDataset) {
            startingDate = newDate;
            startingDataset = tmpStartingDataset;
          }
        }
        // If there is no timelapse object at this point, then that means that we have just arrived at the page
        // with a share link that has an invalid location name.
        // Load the timelapse with the default location specified in the .fail() callback below.
        updateCalendarAndToggleUI(startingDate);
        if (!timelapse) {
          setupTimelapse(startingDataset, startingDate);
          return;
        }
        setGraphTimeRange(startingDate);
        if (doLoad) {
          if (timelapse && startingDataset) {
            newTime = parseFloat(newTime);
            timelapse.loadTimelapse(startingDataset, newView, newTime, false, newTimeAsDateObj, function() {
              if (!newTimeAsDateObj && isNaN(newTime)) {
                var numFrames = timelapse.getNumFrames();
                // 12 fps * 5 seconds = 60 frames
                var fiveSecondsFromEnd = numFrames - 60;
                timelapse.seekToFrame(fiveSecondsFromEnd);
              }
            });
          }
        } else if (typeof(callBack) === "function") {
          callBack();
        }
      }).fail(function(jqXHR, textStatus, errorThrown) {
        console.log(jqXHR, textStatus, errorThrown);
        changeLocation("shenango1", null, null, null, true);
      });
    }
  }

  function updateCalendarAndToggleUI(startingDate) {
    $(".gwt-PopupPanel").remove();
    locationDivId = currentLocation + "_overlay";
    setLocationThumbnailToggle();
    setLocationTitle();
    $("#datepicker").datepicker("destroy");
    loadCalendar(startingDate);
  }

  function loadCalendar(startingDate) {
    pageLoadDate = startingDate;
    currentDate = startingDate;
    var dateArray = startingDate.split("-");
    $("#datepicker").datepicker({
      defaultDate : new Date(dateArray[0], dateArray[1] - 1, dateArray[2]),
      minDate : new Date(2014, 0),
      onSelect : selectDay,
      beforeShowDay : highlightDays
    });
  }

  function highlightDays(date) {
    date = $.datepicker.formatDate('yy-mm-dd', date);
    //if (cached_breathecam.datasets[date])
      return [true, 'date-highlight'];
    //else
      //return [false, ''];
  }

  function selectDay(dateText, dateElem) {
    var date = $.datepicker.formatDate('yy-mm-dd', new Date(dateText));
    //var path = cached_breathecam.datasets[date];
    //if (timelapse && path) {
      $(".gwt-PopupPanel").remove();
      currentDate = date;
      var dayStart = setGraphTimeRange(date);
      plotManager.getDateAxis().setCursorPosition(dayStart);
      repaintCanvasLayer(dayStart);
      //timelapse.loadTimelapse(path, null, null, true);
    //}
  }

  function setLocationThumbnailToggle() {
    $(".location_thumbnail_selected").removeClass("location_thumbnail_selected");
    $("#" + locationDivId).addClass("location_thumbnail_selected");
  }

  function getFormattedTime(date) {
    var hours = date.getHours() === 0 ? "12" : date.getHours() > 12 ? date.getHours() - 12 : date.getHours();
    var minutes = (date.getMinutes() < 10 ? "0" : "") + date.getMinutes();
    var seconds = date.getSeconds();
    var ampm = date.getHours() < 12 ? "AM" : "PM";
    var formattedTime = hours + ":" + minutes + ":" + seconds + " " + ampm;
    return formattedTime;
  }

  function requestEsdrExport(requestInfo, callBack) {
    $.ajax({
      crossDomain: true,
      type: "GET",
      dataType: "text",
      url: ESDR_API_ROOT_URL + "/feeds/" + requestInfo.feed_id + "/channels/" + requestInfo.channels + "/export",
      data: { from: requestInfo.start_time, to: requestInfo.end_time, FeedApiKey: requestInfo.api_key},
      success: function(csvData) {
        if (typeof(callBack) === "function")
          callBack(csvData);
      },
      failure: function(data) {
        console.log('Failed to load sensor data.');
      },
      headers: requestInfo.headers
    });
  }

  function parseEsdrCSV(csvData, sensor) {
    var csvArray = csvData.split("\n");
    var headingsArray = csvArray[0].split(",");
    // First row is the CSV headers, which we took care of above, so start at 1.
    for (var i = 1; i < csvArray.length; i++) {
      var csvLineAsArray = csvArray[i].split(",");
      // First entry is the EPOC time, so start at index 1.
      for (var j = 1; j < csvLineAsArray.length; j++) {
        var tmpChannelHeading = headingsArray[j].split(".");
        var channelHeading = tmpChannelHeading[tmpChannelHeading.length - 1];
        var timeStamp = sensor.channels[channelHeading].hourly ? (csvLineAsArray[0] - 1800): csvLineAsArray[0];
        sensor.channels[channelHeading].summary[timeStamp] = parseFloat(csvLineAsArray[j]);
      }
    }
  }

  function updateAreaSelectionMenu() {
    $('#radioButtonContainer').empty();
    var allLocales = Object.keys(feedMap);
    var locales = (area.id === "richmond" ? allLocales.slice(0,3) : allLocales.slice(3,5));
    $("#areaSelectionMenu").append('<form id="radioButtonContainer"></form>');
    for(var i=0;i<locales.length;i++) {
      $("#radioButtonContainer").append('<input type="radio" name="areaRadioButtonGroup"' + (i==0? 'checked="checked"' : '')
      + 'onclick="changeLocale(\'' + area.id + '\',\'' + locales[i] + '\')">' + locales[i] + '</input>');
    }
  }

  function setupTileSource(channelName, feedAPIKey) {
    return function(level, offset, successCallback, failureCallback) {
      $.ajax({
        type: "GET",
        dataType: "json",
        url: ESDR_API_ROOT_URL + "/feeds/" + feedAPIKey + "/channels/" + channelName + "/tiles/" + level + "." + offset,
        success: function(json) {
          if( showSmokeDetection && channelName=="smoke_level") {
            // Set max smoke reading value
            var max_smoke_value = 300;
            for (var i = 0; i < json.data.data.length; i++) {
              if (json.data.data[i][1] > max_smoke_value) {
                json.data.data[i][1] = max_smoke_value;
              }
            }
          }
          if(channelName != "smoke_level") {
              for (var i=0; i<json.data.data.length; i++) {
                if(json.data.data[i][1] == 0) {
                  json.data.data[i][1] = TILE_BOUNDARY_SENTINEL_VALUE;
                }
              }
            }
          successCallback(JSON.stringify(json.data));
        },
        failure: failureCallback
      });
    };
  };

  var createChart = function(feed, channelName, feedAPIKey) {
    var datasource = setupTileSource(channelName, feedAPIKey);

    // Add charts
    var channelLabel = feed.channels[channelName].graphMetaData.label;
    var idx = loadedSeries.indexOf(channelLabel);
    var seriesIdx = series.length;
    var plotContainerId = seriesIdx + "_plot_container";
    var plotId = seriesIdx + "_plot";
    var yAxisId = seriesIdx + "_yaxis";
    if (idx != -1) {
      var tmpId = new Date().getTime();
      loadedSeries.push(channelLabel + tmpId);
      seriesIdx = idx;
      plotId = seriesIdx + "_plot" + tmpId;
      plotContainerId = seriesIdx + "_plot_container";
      yAxisId = seriesIdx + "_yaxis";
      plotManager.getPlotContainer(plotContainerId).addDataSeriesPlot(plotId, datasource, yAxisId);
    } else {
      series[seriesIdx] = {};
      series[seriesIdx].id = seriesIdx;
      series[seriesIdx].pc = [];
      loadedSeries.push(channelLabel);
      // Add chart html to page since this chart does not exist yet
      var row = $('<tr class="chart"' + 'data-channel=' + channelName + '></tr>');
      var $chartTitle = $('<td class="chartTitle"><div>' + feed.channels[channelName].graphMetaData.label + '</div></td>');
      $chartTitle.hover(
          function() {
            $(this).css("font-weight","bold");
          },
          function() {
            $(this).css("font-weight","normal");
          }
        )
        .attr("title","View in ESDR")
        .click(function(event) {
          var channelName = event.currentTarget.parentElement.attributes["data-channel"].value;
          var channels = "#channels=";
          for(var feed of feedMap[area.locale]) {
            channels += feed + "." + channelName + ",";
          }
          channels = channels.slice(0,channels.length-1);
          var range = plotManager.getDateAxis().getRange();
          var time = range.min + "," + range.max;
          var cursor = plotManager.getDateAxis().getCursorPosition();
          var win = window.open("https://esdr.cmucreatelab.org/browse/"+channels+"&time=" + time + "&zoom=10&center=37.89143760613535,-121.80124835968014&cursor=" + cursor, "_blank");
          if (win) {
            win.focus();
          }
          else {
            alert('Please allow popups for this website in order to go to detail view on ESDR');
          }
        });
      row.append($chartTitle);
      row.append('<td id="' + plotContainerId + '" class="chartContent"></td>');
      row.append('<td id="' + yAxisId + '" class="chartAxis"></td>');
      $('#grapher').append(row);

      addGraphOverlays(seriesIdx, channelLabel);

      if (showSmokeDetection && channelName == "smoke_level") {
        hideSmokeDetectionGraph();
        loadMetaData(currentDate, currentLocation);
        timelapse.addDatasetLoadedListener(function() {
          loadMetaData(currentDate, currentLocation);
        });
      }
      plotManager.addDataSeriesPlot(plotId, datasource, plotContainerId, yAxisId);
      adjustGraphOverlays(seriesIdx, channelLabel);
      plotManager.getYAxis(yAxisId).addAxisChangeListener(function() {
        adjustGraphOverlays(seriesIdx, channelLabel);
      });
      window.setTimeout(function() { $(window).trigger('resize'); }, 50);
    }
    var cursorColor = (feed.isDouble) ? "rgba(0,0,0,0)" : "#2A2A2A";
    var color_line = (feed.isDouble ? "rgb(245,124,0)" : "rgb(1,87,155)");
    plotManager.getPlot(plotId).addDataPointListener(function(val) {
      var valueHoverElement = $("#valueHover" + seriesIdx);
      if (val == null) {
         valueHoverElement.empty().hide();
      }
      else {
         valueHoverElement.text(val.valueString.substr(0,4)).show();
      }
   });
  plotManager.getPlot(plotId).setStyle({
    "cursor" : {
      "color" : cursorColor,
      "lineWidth" : 1
    },
    "styles": [
      { "type" : "line", "lineWidth" : 1, "show" : true, "color" : color_line },
      { "type" : "circle", radius : 1.2, "lineWidth" : 1, "show" : false, "color" : "black", fill : true }
    ]
  });
    var plotContainer = plotManager.getPlotContainer(plotContainerId);
    setMinRangeToHealthLimit(plotContainer, channelLabel);
    plotContainer.setAutoScaleEnabled(true, true);
    series[seriesIdx].pc.push(plotContainer);
  };

  function setMinRangeToHealthLimit(plotContainer, channelLabel) {
    var healthLimit = healthLimitMap[channelLabel];
    var pad = healthLimit * 0.1;
    plotContainer.getYAxis().constrainMinRangeTo(-pad,healthLimit+pad);
    plotContainer.getYAxis().setRange(-pad,healthLimit+pad);
  }

  function getChannelLabel(seriesIdx) {
    return $("#" + seriesIdx + "_plot_container")[0].parentElement.firstChild.firstChild.innerHTML;
  }

  function addGraphOverlays(seriesIdx) {
    var channelLabel = getChannelLabel(seriesIdx);
    if (healthLimitMap[channelLabel]) {
      $("#" + seriesIdx + "_plot_container").append("<div id='healthDangerBox" + seriesIdx + "' class='healthDangerBox'></div>");
    }
    if (area.id == "richmond" && communityDetectionLimitMap[channelLabel]) {
      $("#" + seriesIdx + "_plot_container").append("<div id='greyAreaBox" + seriesIdx + "' class='greyAreaBox'></div>");
    }
    if (refineryDetectionLimitMap[channelLabel]) {
      $("#" + seriesIdx + "_plot_container").append("<div id='refineryDetectionLimit" + seriesIdx + "' class='refineryDetectionLimit'></div>");
    }
    $("#" + seriesIdx + "_plot_container").append("<div id='valueHover" + seriesIdx + "' class='valueHover'></div>");
  }

  function adjustGraphOverlays(seriesIdx) {
    var channelLabel = getChannelLabel(seriesIdx);
    var axis = plotManager.getYAxis(seriesIdx + "_yaxis");
    //var axis = series[seriesIdx].axis;
    var chartHeight = $('.chart').height();
    var range = axis.getRange();

    var level = healthLimitMap[channelLabel];
    var overlayHeight = (range.max - level) / (range.max - range.min) * chartHeight;
    //var overlayHeight = (axis.getMax() - level) / (axis.getMax() - axis.getMin()) * chartHeight;
    $('#healthDangerBox' + seriesIdx)
        .height(overlayHeight)
        .css("max-height", chartHeight);

    level = communityDetectionLimitMap[channelLabel];
    overlayHeight = (range.max - level) / (range.max - range.min) * chartHeight;
    var borderVisible;
    overlayHeight > 2 ? borderVisible = "2px" : borderVisible = "0px";
    $('#greyAreaBox' + seriesIdx)
        .height(overlayHeight)
        .css({"max-height": chartHeight, "border-bottom-width": borderVisible});

    level = refineryDetectionLimitMap[channelLabel];
    overlayHeight = (range.max - level) / (range.max - range.min) * chartHeight;
    overlayHeight > 2 ? borderVisible = "2px" : borderVisible = "0px";
    $('#refineryDetectionLimit' + seriesIdx)
        .height(overlayHeight)
        .css({"max-height": chartHeight, "border-bottom-width": borderVisible});
  }

  function zoomGrapher(scale) {
    var min_time = plotManager.getDateAxis().getRange().min;
    var max_time = plotManager.getDateAxis().getRange().max;
    var mean_time = (max_time+min_time)/2;
    var range_half_scaled = scale*(max_time-min_time)/2;
    plotManager.getDateAxis().setRange(mean_time-range_half_scaled,mean_time+range_half_scaled);
  }

  function grapherZoomToWeek() {
    var max_time = plotManager.getDateAxis().getRange().max;
    var weekLength = 590707;
    plotManager.getDateAxis().setRange(max_time-weekLength,max_time);
  }

  function grapherZoomToDay() {
    var max_time = plotManager.getDateAxis().getRange().max;
    var dayLength = 82918;
    plotManager.getDateAxis().setRange(max_time-dayLength,max_time);
  }

  function setSizes() {
    var height = $('.chart').height();
    $('.chartContent').height(height - 1);
    $('.chartTitle').height(height - 23);
    $('.chartAxis').height(height - 1);
    plotManager.forEachPlotContainer(function(pc) {
      pc.setHeight(height);
    });
    for (var i = 0; i < series.length; i++) {
      adjustGraphOverlays(i);
    }
    google.maps.event.trigger(map, 'resize');
  }

  var dateAxisListener = function(event) {
    var timeInSecs = event.cursorPosition;
    var d = new Date(timeInSecs * 1000);
    var pad = function(num) {
      var norm = Math.abs(Math.floor(num));
      return (norm < 10 ? '0' : '') + norm;
    }
    var dateString = d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate());
    if(dateString != currentDate) {
      updateCalendarAndToggleUI(dateString);
    }
    repaintCanvasLayer(timeInSecs);
  };

  function setGraphTimeRange(date) {
    var axis = plotManager.getDateAxis();
    if (!axis) return;
    var dayStartString = date + " 00:00:00";
    var dayEndString = date + " 23:59:59";
    var dayStart = (new Date((dayStartString).replace(/-/g,"/")).getTime()) / 1000;
    var dayEnd = (new Date((dayEndString).replace(/-/g,"/")).getTime()) / 1000;
    axis.setRange(dayStart, dayEnd);
    return dayStart;
  }

  function toggleYAxisAutoScaling() {
  var autoScaleToggleButton = $("#auto_scale_toggle_button");
  var isAutoScaleOff = autoScaleToggleButton.hasClass("toggle-button-off");
  plotManager.forEachPlotContainer(function (pc) {
    pc.setAutoScaleEnabled(isAutoScaleOff, false);
    if(isAutoScaleOff) {
      var channelLabel = getChannelLabel(pc.getElementId()[0]);
      setMinRangeToHealthLimit(pc, channelLabel);
    }
    else {
      pc.getYAxis().clearMinRangeConstraints();
    }
  });
  if (isAutoScaleOff) {
    autoScaleToggleButton.removeClass("toggle-button-off");
  }
  else {
   autoScaleToggleButton.addClass("toggle-button-off");
  }
}

  function initialize() {
    selectArea($("title")[0].innerText);
    updateAreaSelectionMenu();
    $("body, html").css("overflow", "hidden");
    if (!timelapse) {
      channelPageSetup();
    } else {
      refreshChannelPage();
    }
    google.maps.event.trigger(map, 'resize');
  }

  window.grapherLoad = function() {
    var maxTimeSecs = Date.now() / 1000;
    var minTimeSecs = maxTimeSecs - 1 * 24 * 60 * 60;
    plotManager = new org.bodytrack.grapher.PlotManager("dateAxis", minTimeSecs, maxTimeSecs);
    $(window).resize(function() {
      setSizes();
    });
    plotManager.setWillAutoResizeWidth(true, function() {
      return $("#grapher").width() - 34 - 136 - 26;
    });
    grapherReady = true;
    initialize();
  };

  //$(initialize);

  function createTutorialButton(buttonWidth, buttonHeight, appendingDiv) {
    var $tutorialButton = $("<div class='tutorialButton'>Quick Tour</div>");
    $tutorialButton.attr({"id" : "timeMachine_tutorialButton", "title" : "Watch an instructional video on how to use Shenango Channel"});
    $tutorialButton.button({
      icons: {
        primary: "ui-icon-custom-tutorialButton"
      },
      text: true
    }).on("click", function() {
      var $tourDialog = $("#tutorialDialog");
      if ($tourDialog.dialog("isOpen")) {
        $tourDialog.dialog("close");
        $("#tutorialIframe").remove();
      } else {
        $("#tutorialDialog").append('<iframe id="tutorialIframe" src="//player.vimeo.com/video/140196813?autoplay=1" width="100%" height="100%" frameborder="0" webkitallowfullscreen mozallowfullscreen allowfullscreen></iframe>');
        $tourDialog.dialog("open");
      }
    });
    $tutorialButton.appendTo($(appendingDiv));

    $("#tutorialDialog").dialog({
      resizable: false,
      autoOpen: false,
      dialogClass: "customDialog",
      width: buttonWidth,
      height: buttonHeight,
      modal: true,
      open: function( event, ui ) {
        $(this).parent().css("top", "0px");
        $(".ui-widget-overlay").on('click', function(){
          $("#tutorialDialog").dialog('close');
        });
      },
      close: function( event, ui ) {
        $("#tutorialIframe").remove();
      }
    });
  }

  function initFeeds() {
    var feedNames = Object.keys(esdr_feeds).sort();
    if(showSmokeDetection) {
      feedNames.splice(feedNames.indexOf("Smoke_Detection"), 1);
      feedNames[feedNames.length] = "Smoke_Detection";
    }
    for (var i = 0; i < feedNames.length; i++) {
      (function(i){
        $.ajax({
          type: "GET",
          dataType: "json",
          url: ESDR_API_ROOT_URL + '/feeds/' + esdr_feeds[feedNames[i]].api_key,
          success: function(json) {
            esdr_feeds[feedNames[i]].fullTimeRange.min = json.data.minTimeSecs;
            esdr_feeds[feedNames[i]].fullTimeRange.max = json.data.maxTimeSecs;
            if (i == feedNames.length - 1) {
              for (var j = 0; j < feedNames.length; j++) {
                (function(j){
                  var feed = esdr_feeds[feedNames[j]];
                  var channelNames = Object.keys(feed.channels);
                  channelNames.forEach(function(channelName) {
                    if (!feed.channels[channelName].show_graph) return;
                    createChart(feed, channelName, feed.api_key);
                  });
                })(j);
              }
            }
          }
        });
      })(i);
    }
    if (canvasLayer)
    repaintCanvasLayer();
  }

  function channelPageSetup() {
    if (!tmReady) {
      // Initialize E-Cam
      var timelapseSupported = org.gigapan.Util.browserSupported();
      var stitchedImage = "N/A";
      locationDivId = "shenango1" + "_overlay";
      setLocationThumbnailToggle();
      $(".location_thumbnail_container").on("click", function() {
        if (window.location.hash)
          window.location.hash = "";
        var newLocation = $(this).attr("data-location-id");
        if (timelapse)
          var captureTimeAsDateObj = new Date(timelapse.getCurrentCaptureTime().replace(/-/g,"/"));
        changeLocation(newLocation, currentDate, null, null, true, null, captureTimeAsDateObj);
      });
      if ((!timelapseSupported || typeof (cached_breathecam) === "undefined") && stitchedImage === "") {
        // Nothing is up. Hide containers and inform the user
        $("#stitched_image_wrapper").hide();
        $("#location_toggle_container").hide();
        $("#loading").html("<div class='error_msg2'>Content currently unavailable. Please try again later.</div>");
      }
      else {
        // Show timelapse
        tm_init();
      }
    }

    // Initialize Map
    initMap('map-canvas');

    //Zoom buttons
    $("#zoomGrapherIn").on("click", function() {
      zoomGrapher(0.7);
    });
    $("#zoomGrapherOut").on("click", function() {
      zoomGrapher(1.3);
    });

    //Initialize playback things
    plotManager.getDateAxis().addAxisChangeListener(dateAxisListener);
    $("#play").on("click", function() {
      var icon = $("#playIcon");
      icon.toggleClass("glyphicon-play");
      icon.toggleClass("glyphicon-pause");
      icon.hasClass("glyphicon-pause") ? play() : pause();
    });
    $("#slider").slider({
      stop: function(event,ui) {
        playSpeed = 15 + (10 * ui.value);
      }
    });
    var initTime = plotManager.getDateAxis().getRange().max;
    plotManager.getDateAxis().setCursorPosition(initTime);
    plotManager.getDateAxis().setRange(initTime - 8 * 60 * 60, initTime);
    plotManager.getDateAxis().getWrappedAxis().isTwelveHour = true
    repaintCanvasLayer(initTime);

    grapherLoadedInterval = window.setInterval(function() {
      if (!grapherReady) return;

      window.clearInterval(grapherLoadedInterval);
      grapherLoadedInterval = null;

      // Initialize Smells
      initSmells();

      // Initialize Graphs
      loadFeeds(feedMap[area.locale]);

    }, 10);
  }

  window.requestAnim =
    window.requestAnimationFrame ||
    window.webkitRequestAnimationFrame ||
    window.mozRequestAnimationFrame ||
    window.oRequestAnimationFrame ||
    window.msRequestAnimationFrame ||
    function(callback) {
      return window.setTimeout(callback, 10);
    };

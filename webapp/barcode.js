/*
JavaScript file supporting a Barcode Scanning Inventory Process that Pulls Data from Alma API.

Author: Terry Brady, Georgetown University Libraries

Dependencies
  1. JQuery UI Dialog:https://jqueryui.com/dialog/
  2. A web service that returns data from the Alma API based on a Barcode: https://github.com/Georgetown-University-Libraries/BarcodeInventory
  3. A Google Apps Web Service that converts CSV data into a Google Sheet: https://github.com/Georgetown-University-Libraries/PlainTextCSV_GoogleAppsScript

Credits
  This code uses a LC Call Number Sort module developed by Ray Voelker from the University of Dayton Library
  https://github.com/rayvoelker/js-loc-callnumbers

License information is contained below.

Copyright (c) 2018, Georgetown University Libraries All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials
provided with the distribution. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING,
BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

*/

//barcode.init.js will set API_REDIRECT, API_SERVICE, LOC_REGEX

//Create the GSheet Object using a local property file
//This file contains the name of the web service that will be used to create a Google Sheet
var gsheet = new GSheet("gsheet.prop.json");

//Main dialog box used when scanning
var dialog;
//Bulk ingest dialog box
var dialogBulk;
//Legend dialog
var dialogLegend;

//Test barcode ids loaded by URL parameter for demonstration purposes
var testArr = [];

//Global counter to assign a unique id to every scan performed within a session
var sr=1;

//Other colors Anna has: kelly green, grey, goldenrod
var STAT_FAIL = "FAIL";
var COLORMAP = [
  {status: "PASS",       color: "white",        nickname: "white",           desc: "Information is valid.  No action required."},
  {status: STAT_FAIL,    color: "pink",         nickname: "pink",            desc: "Retrieval failed.  Try to refresh again.  File a ticket with <a href=\"mailto:support@carli.illinois.edu\">CARLI Support</a> if the issue persists."},
  {status: "NOT-FOUND",  color: "coral",        nickname: "red",             desc: "No Alma data for barcode."},
  {status: "META-CALL",  color: "darkorange",   nickname: "electric orange",  desc: "Bad Call Number."},
  {status: "META-TTL",   color: "lightskyblue", nickname: "blue",            desc: "Bad Title."},
  {status: "META-VOL",   color: "lightgreen",   nickname: "mint green",      desc: "Bad Volume."},
  {status: "PULL-STAT",  color: "goldenrod",    nickname: "goldenrod",       desc: "Incorrect status code."},
  {status: "PULL-LOC",   color: "yellow",       nickname: "yellow",          desc: "Incorrect location."},
  {status: "PULL-SUPP",  color: "tan",          nickname: "tan",             desc: "Bib is marked as suppressed."},
  {status: "PULL-HSUPP", color: "violet",       nickname: "purple",          desc: "Holding is suppressed."},
  {status: "PULL-DUE",   color: "chartreuse",   nickname: "electric green",  desc: "Item is checked out in ALma."},
  {status: "PULL-MULT",  color: "grey",         nickname: "grey",            desc: "Multiple issues."},
];
var STATUSES = [];

function colorInit() {
  var ruletemplate = "tr.STATUS td, tr.STATUS button, tr.STATUS th, #laststatus.STATUS {background-color: COLOR;}\n";
  var cssrules =  $("<style type='text/css'> </style>").appendTo("head");
  var cssbuf = "";
  var colorRow = "<tr class='STATUS'><th class='legnick'>NICK</th><td class='legstat'>STATUS</td><td class='legdesc'>DESC</td></tr>";
  var colorTbl =  $("<table id='legend'/>").appendTo("#legend-div");
  for(var i=0; i<COLORMAP.length; i++) {
    var status   = COLORMAP[i].status;
    var color    = COLORMAP[i].color;
    var nickname = COLORMAP[i].nickname;
    var desc     = COLORMAP[i].desc;
    STATUSES.push(status);
    var rule = ruletemplate.replace(/STATUS/g, status).replace(/COLOR/g, color);
    cssbuf += rule
    var row = colorRow.replace(/STATUS/g, status).replace(/COLOR/g, color).replace(/NICK/g, nickname).replace(/DESC/g, desc);
    colorTbl.append($(row));
  }
  cssrules.text(cssbuf);
}

function getTestCodes(){
  var re = /.*test=([0-9\-,]+)(&.*)?$/;
  if (re.test(document.location.search)) {
    var m = re.exec(document.location.search);
    if (m.length > 1) {
      $("#test").val(m[1]);
    }
  }
}

/*
 * Initialize application
 */
$(document).ready(function(){
  getTestCodes();
  colorInit();
  initDialogs();
  bindEvents();
  populateLibs();

  var s = $("#test").val();
  if (s != "" && s!= null) {
    loadDemonstrationBarcodes(s);
  } else if ('barcodes' in localStorage) {
    if (localStorage.barcodes != "" && localStorage.barcodes != null) {
      restoreAutoSaveBarcodes()
    } else {
      barcodeDialog();
    }
  } else {
    barcodeDialog();
  }
});


//initialize dialog boxes with JQuery Dialog
function initDialogs() {
  dialog = $("#dialog-form").dialog({
    autoOpen : false,
    height : 600,
    width : 700,
    modal : true,
    buttons : {
      "Add Barcode" : function() {
        addCurrentBarcode();
      },
      "Done" : function() {
        dialog.dialog("close");
        $("#gsheetdiv").show();
        $("#beepdiv").show();
      }
    },
    close : function(event, ui) {
      $("#gsheetdiv").show();
      $("#beepdiv").show();
    }
  });

  dialogBulk = $("#dialog-bulk").dialog({
    autoOpen : false,
    height : 500,
    width : 400,
    modal : true,
    buttons : {
      "Add Barcodes" : function() {
        var codeArr = $("#barcodes").val().split("\n");
        var title = codeArr.length + " barcodes will be added.  Click OK to continue.";
        mydialog("Confirm Bulk Add", title, function() {
          dialogBulk.dialog("close");
          dialog.dialog("close");
          for (var i = 0; i < codeArr.length; i++) {
            if (isDuplicateBarcode(codeArr[i])) {
              console.log('DUPLICATE barcode=' + codeArr[i] + ' ; Skipping...');
              continue;
            }
            addBarcode(codeArr[i], false);
          }
        });
      },
      "Cancel" : function() {
        dialogBulk.dialog("close");
      }
    },
  });

  dialogLegend = $("#legend-div").dialog({
    autoOpen : false,
    height : 650,
    width : 750,
    modal : false,
    buttons : {
      "Done" : function() {
        dialogLegend.dialog("close");
      }
    },
  });
}


function downloadToFile (content, filename, contentType) {
  var popup = window.open(); 

  const a = document.createElement('a');
  const file = new Blob([content], {type: contentType});
  
  a.href= URL.createObjectURL(file);
  a.download = filename;

  popup.document.body.appendChild(a); 

  a.click();

  URL.revokeObjectURL(a.href);
}


/*
 * Bind Action Events to page
 */
function bindEvents() {
  //Activate Add Barcode Modal Dialog
  $("#addb").on("click", function(){
    $("tr.current").removeClass("current");
    barcodeDialog();
  });

  //Bind the enter key to the Add Barcode Button
  $(document).bind('keypress', function(e){
    if ( e.keyCode == 13 ) {
      $("button.ui-button:first:enabled").click();
      return false;
    }
  });

  //Trigger barcode format validation during text entry
  $("#barcode").on("keyup", function(){valBarcode()});
  $("#barcode").on("change", function(){valBarcode()});

  $("#loadBarcodes").on("click", function(){
    let input = document.createElement('input');
    input.type = 'file';
    input.onchange = _this => {
              let files =   Array.from(input.files);
              //console.log(files);
              const reader = new FileReader();
              reader.onload = function (event) {
                //console.log(event.target.result); // the CSV content as string
                const data = $.csv.toObjects(event.target.result);
                let barcodes = '';
                let i = 0;
                let barcode_key = 'barcode';
                for (let line of data) {
                  if (i == 0) {
                    for (k in line) {
                      let matches = k.match(/^(barcode[s]*)$/i);
                      if (matches && matches.length > 0) {
                        barcode_key = matches[0];
                      }
                    }
                  }
                  let b = '';
                  if (line[barcode_key]) {
                    b = line[barcode_key];
                  } else {
                    console.log('barcode is undefined');
                    continue;
                  }
                  if (b.match(/^="[0-9]+"$/)) {
                    b = b.replace(/^="/, "");
                    b = b.replace(/"$/, "");
                  }
                  if (i++ > 0) barcodes += "\n";
                  barcodes += b;
                }
                $("#barcodes").val(barcodes);
              };
              reader.readAsText(files[0]);
          };
    input.click();
  });

  $("#downloadCsv").on("click", function(){
    var cnt = $("tr.datarow").length;
    if (cnt == 0) {
      var msg = $("<div>There is no data to export.  Please scan some barcodes</div>");
      mydialog("No data available", msg, function() {
        barcodeDialog();
      });
      return;
    }

    var ssname = makeSpreadsheetName() + '.csv';
    var nodes = $("#restable tr");
    var csv = gsheet.makeCsv(nodes);
    csv = csv.replace(/\r/g, "");
    var lines = csv.split("\n");
    var csvReversed = "";
    for(var i=1; i<lines.length; i++)
        csvReversed = lines[i] + "\n" + csvReversed;
    csvReversed = lines[0] + "\n" + csvReversed;
    downloadToFile(csvReversed, ssname, 'text/csv');
    var msg = $("<div>Please confirm that <b>"+cnt+"</b> barcodes were successfully exported. Click <b>OK</b> delete those barcodes from this page.</div>");
    mydialog("Clear Barcode Table?", msg, function() {
      $("tr.datarow").remove();
      autosave();
      barcodeDialog();
    });
  });

  //Activate export to Google Sheets function
  $("#exportGsheet").on("click", function(){
    var cnt = $("tr.datarow").length;
    if (cnt == 0) {
      var msg = $("<div>There is no data to export.  Please scan some barcodes</div>");
      mydialog("No data available", msg, function() {
        barcodeDialog();
      });
      return;
    }

    var folderid = $("#mode").val() == "PROD" ? gsheet.props.folderid : gsheet.props.folderidtest;
    var ssname = window.location.pathname.match(/^\/org\/([^\/]+)/)[1] + '_' + makeSpreadsheetName();
    var nodes = $("#restable tr");
    //var buf = ssname + "\n" + $("#user").val() + "\n" + gsheet.makeCsv(nodes);
    /*
    $.ajax({
      type: "PUT",
      url: "barcodeReportLog.php",
      dataType: "text",
      data: buf
    })
    */

    gsheet.gsheet(nodes, ssname, folderid);
    var msg = $("<div>Please confirm that <b>"+cnt+"</b> barcodes were successfully exported and saved to Google sheets.Click <b>OK</b> delete those barcodes from this page.</div>");
    mydialog("Clear Barcode Table?", msg, function() {
      $("tr.datarow").remove();
      autosave();
      barcodeDialog();
    });
  });

  //Activate buttons that change the status of the last item scanned
  $("button.lastbutt").on("click", function() {
    var status = $(this).attr("status");
    var tr = getCurrentRow();
    tr.removeClass(STATUSES.join(" ")).addClass(status);
    tr.find("td.status").text(status);
    $("#laststatus").text(status).removeClass(STATUSES.join(" ")).addClass(status);
    tr.find("td.status_msg").text($(this).attr("status_msg"));
    autosave();
  });

  //Activate the rescan behavior for the last item scanned
  $("button.rescan").on("click", function() {
    refreshTableRow(getCurrentRow());
  });

  //Show the bulk barcode add dialog (copy/paste a list of barcodes)
  $("#doBulk").on("click", function(){
    bulkDialog();
  });

  //Show the bulk barcode add dialog (copy/paste a list of barcodes)
  $("#legend-button").on("click", function(){
    dialogLegend.dialog( "option", "title", "Status Legend").dialog( "open" );
  });

}

/*
 * In order to demonstrate the tool to others, a comma-separated list of barcodes can be pre-loaded using the test parameter.
 * The scanning process will be simulated by a user hitting Alt-S
 */
function loadDemonstrationBarcodes(s){
  testArr = s.split(",");
  barcodeDialog();
  var cnt = testArr.length;
  var msg = $("<div>A list of <b>"+cnt+"</b> barcodes have been provided for testing.<br/><br/>Click <b>Alt-S</b> to simulate scanning with these barcodes</div>");
  mydialog("Confirm", msg, function() {
    $(document).on("keydown", function(e){
      if (e.altKey && e.key=="s") {
        if (testArr.length > 0) {
          var s = testArr.shift();
          $("#barcode").val(s);
          if (valBarcode()) {
            addCurrentBarcode();
          }
        }
      }
    });
  });
}

/*
 * Restore auto-saved barcodes.  This is in place in case a user accidentally closes a browser before saving work
 */
function restoreAutoSaveBarcodes(){
  var arr = localStorage.barcodes.split("!!!!");
  var cnt = arr.length;
  var msg = $("<div>A list of <b>"+cnt+"</b> barcodes exist from a prior session<br/><br/>Click <b>OK</b> to load them.<br/><br/>Click <b>CANCEL</b> to start with an empty list.</div>");
  mydialog("Add Autosave Barcodes?", msg, function() {
      for(var i=0; i< cnt; i++) {
          var rowarr = arr[i].split("||");
          restoreRow(rowarr);
      }
      barcodeDialog();
  });
}

//Get the last row that was (re)scanned
function getCurrentRow() {
  var tr = $("tr.datarow.current");
  if (tr.length == 0) {
    tr = $("tr.datarow:first");
    tr.addClass("current");
  }
  return tr;
}

//Display the add barcode dialog
//Display information for the last item that was (re)scanned
function barcodeDialog() {
  //Hide non modal buttons
  $("#gsheetdiv").hide();
  $("#beepdiv").hide();

  //Show metadata for last scanned item
  var tr=getCurrentRow();
  $("#lastbarcode").text(tr.find("th.barcode").text());
  $("#bcCall").text(tr.find("td.call_number").text());
  $("#bcTitle").text(tr.find("td.title").text());
  $("#bcVol").text(tr.find("td.volume").text());

  //Show status for last scanned item
  var status = tr.find("td.status").text();
  $("#lbreset").attr("status", status);
  $("#laststatus").text(status).removeClass(STATUSES.join(" ")).addClass(status);
  $("#lbreset").attr("status_msg", tr.find("td.status_msg").text());

  //Refresh dialog display
  var cnt = testArr.length;
  var title = cnt > 0 ? "Add Barcode (Demo Scans:" + cnt + ")": "Add Barcode"
  dialog.dialog( "option", "title", title).dialog( "open" );
  $("#barcode").focus();
}

//Display bulk add dialog
function bulkDialog() {
  $("#barcodes").val("");
  var cnt = testArr.length;
  var title = "Bulk Add Barcodes";
  dialogBulk.dialog( "option", "title", title).dialog( "open" );
}

//Compute name to be used for Google Sheet Export
//Name will be based on the first and last call numbers scanned
function makeSpreadsheetName() {
  $("td.call_number").removeClass("has_val");
  $("td.call_number").each(function(){
    if ($(this).text() != "") $(this).addClass("has_val");
  });

  var start = $("tr.datarow td.call_number.has_val:first").text();
  start = (start == "") ? "NA" : start;

  var end = $("tr.datarow td.call_number.has_val:last").text();
  end = (end == "") ? "NA" : end;

  $("td.call_number").removeClass("has_val");
  return end + "--" + start;
}

//Delete row function
//  cell - delete button triggering this action
function delrow(cell) {
  var tr = $(cell).parents("tr");
  var prevtr = tr.prev("tr.datarow");
  tr.remove();
  if (prevtr.is("tr")) {
    setLcSortStat(prevtr);
  }
  autosave();
}

//Refresh table row
//  tr - JQuery representation of table row containing barcode to refresh
function refreshTableRow(tr) {
  $("tr.current").removeClass("current");
  tr.removeClass(STATUSES.join(" ")).addClass("new current");
  processCodes(true);
}

//Refresh table row
//  cell - refresh button triggering this action
function refreshrow(cell) {
  refreshTableRow($(cell).parents("tr"));
}

//Add the barcode contained in the barcode text input field
function addCurrentBarcode() {
  $("#bcCall").text("");
  $("#bcTitle").text("");
  $("#bcVol").text("");
  var v = $("#barcode").val();
  addBarcode(v, true);
  $("#barcode").val("").focus();
  $("#message").text("Barcode " + v + " added. Scan the next barcode.");
}

//Add the barcode value to the table
//  barcode - string
//  show - boolean, indicates whether or not to display the barcode dialog after adding the barcode
function addBarcode(barcode, show) {
  if (barcode == null || barcode == "") return;
  var tr = getNewRow(true, barcode);
  tr.append($("<td class='location_code'/>"));
  tr.append($("<td class='call_number'/>"));
  tr.append($("<td class='volume'/>"));
  tr.append($("<td class='title'/>"));
  tr.append($("<td class='process'/>"));
  tr.append($("<td class='temp_location'/>"));
  tr.append($("<td class='bib_supp'/>"));
  tr.append($("<td class='hold_supp'/>"));
  tr.append($("<td class='record_num'/>"));
  tr.append($("<td class='status'/>"));
  tr.append($("<td class='status_msg'/>"));
  tr.append($("<td class='timestamp'/>"));
  $("#restable tr.header").after(tr);
  processCodes(show);
}

//Create new table row
//  processRow - boolean - indicates whether or not to add the "new" class that will trigger a rescan
//  barcode - barcode value to add to the row
function getNewRow(processRow, barcode) {
  //increment row identifier for session
  sr++;

  //Remove the current class from the former current row
  $("tr.current").removeClass("current");

  //Create current row
  var tr = $("<tr/>");
  tr.addClass(processRow ? "datarow new current" : "datarow current");
  tr.attr("barcode", barcode);

  //Create action buttons and barcode cell
  tr.append(getButtonCell());
  tr.append($("<th class='barcode'>" + barcode + "</th>"));
  return tr;
}

function getButtonCell() {
  //http://www.w3schools.com/w3css/w3css_icons.asp
  var td = $("<td class='noexport action'/>");
  td.append($("<button onclick='javascript:delrow(this);'><i class='material-icons'>delete</i></button>"));
  td.append($("<button onclick='javascript:refreshrow(this);'><i class='material-icons'>refresh</i></button>"));
  return td;
}

function restoreRow(rowarr) {
    if (rowarr == null) return;
    if (rowarr.length != 13) return;

    var barcode = rowarr.shift();
    var tr = getNewRow(false, barcode);

    tr.append($("<td class='location_code'>" + rowarr.shift() + "</td>"));
    tr.append($("<td class='call_number'>" + rowarr.shift() + "</td>"));
    tr.append($("<td class='volume'>" + rowarr.shift() + "</td>"));
    tr.append($("<td class='title'>" + rowarr.shift() + "</td>"));
    tr.append($("<td class='process'>" + rowarr.shift() + "</td>"));
    tr.append($("<td class='temp_location'>" + rowarr.shift() + "</td>"));
    tr.append($("<td class='bib_supp'>" + rowarr.shift() + "</td>"));
    tr.append($("<td class='hold_supp'>" + rowarr.shift() + "</td>"));
    tr.append($("<td class='record_num'>" + rowarr.shift() + "</td>"));
    tr.append($("<td class='status'>" + rowarr.shift() + "</td>"));
    tr.append($("<td class='status_msg'>" + rowarr.shift() + "</td>"));
    tr.append($("<td class='timestamp'>" + rowarr.shift() + "</td>"));
    tr.addClass(tr.find("td.status").text());
    $("#restable tr.header").after(tr);
    setLcSortStat(tr);
    autosave()
}

//Save user session into html5 local storage
function autosave() {
  var arr = [];
  $("tr.datarow").each(function() {
    var rowarr = [];
    $(this).find("th,td:not(.noexport)").each(function() {
      rowarr.push($(this).text());
    });
    arr.push(rowarr.join("||"));
  });
  localStorage.barcodes=arr.reverse().join("!!!!");
}

/*
 * Set the status fields for a row
 *   tr         - jQuery element - Table Row
 *   status     - String - Status Value
 *   status_msg - String - Status details (or null to leave unchanged)
 *   show       - boolean - show the status dialog
 */
function setRowStatus(tr, status, status_msg, show) {
  tr.find("td.status").text(status);
  tr.removeClass("processing");
  tr.addClass(status);
  if (status_msg != null) tr.find("td.status_msg").text(status_msg);
  tr.addClass(status);
  //console.log('setRowStatus', status);
  if (status != 'PASS') {
    soundBeep();
  }
  autosave();
  processCodes(show);
  if ($("#lastbarcode").text() == tr.attr("barcode")) {
    $("#laststatus").text(status).removeClass().addClass(status);
  }
  if (show) barcodeDialog();
}

function updateRowStat(tr) {
  if (!(tr.hasClass("bib_check") && tr.hasClass("hold_check"))) {
    //wait for the status to be set on the other field
    return;
  }

  var stat = tr.find("td.status").text();
  var statmsg = tr.find("td.status_msg").text();
  if (tr.hasClass("bib_supp")) {
    statmsg += "Bib suppressed. ";
    stat = (stat == "PASS") ? "PULL-SUPP" : "PULL-MULT";
  } else if (tr.hasClass("hold_supp")) {
    statmsg += "Holding suppressed. ";
    stat = (stat == "PASS") ? "PULL-HSUPP" : "PULL-MULT";
  } else {
    return;
  }
  setRowStatus(tr, stat, statmsg, false);
}


function getBarcodeFromUrl(url) {
  var match = /.*item_barcode=(.+)$/.exec(url);
  if (match == null) {
    return "";
  }
  return (match.length > 1) ? match[1] : "";
}

function getArray(json, name) {
  if (json == null) return {};
  return (name in json) ? json[name] : {};
}

function getValueWithDef(json, name, def) {
  if (json == null) return def;
  return (name in json) ? json[name] : def;
}

function getValue(json, name) {
  return getValueWithDef(json, name, "");
}

function getArrayValue(json, aname, vname) {
  return getArrayValueWithDef(json, aname, vname, "");
}

function getArrayValueWithDef(json, aname, vname, def) {
  if (json == null) return def;
  return getValueWithDef(getArray(json, aname), vname, def);
}

function parseResponse(barcode, json) {
  var resdata = {}
  if ('errorsExist' in json) {
    var status = "NOT-FOUND";
    var status_msg = "--";
    var errorList = getArray(json, "errorList");
    var errorArr = ('error' in errorList) ? errorList["error"] : [];
    if (errorArr.length > 0) {
      var error = errorArr[0];
      status_msg = getValueWithDef(error, 'errorCode', "--") + ": "
      status_msg += getValueWithDef(error, 'errorMessage', "--");
    }
    resdata = {
      "barcode": barcode,
      "status": status,
      "status_msg": status_msg
    };
  } else {
    var status = "PASS";
    var status_msg = "Barcode Found. ";
    var bibData = getArray(json, "bib_data");
    var bibLink = getValue(bibData, "link");

    var holdingData = getArray(json, "holding_data");
    var holdingLink = getValue(holdingData, "link");
    var itemData = getArray(json, "item_data");
    var loc = getArrayValue(itemData, "location", "value");
    var tempLoc = getArrayValue(holdingData, "temp_location", "");
    //var base = getArrayValue(itemData, "base_status", "value");
    //var requested = getValue(itemData, "requested");
    var process = getArrayValue(itemData, "process_type", "value")
        .replace(/_/g," ")
        .replace(/WORK ORDER.*/,"Work Order");
    var date = new Date();
    var m = date.getMonth() + 1;
    var timestamp = date.getFullYear()+"-"+
      ((m < 10) ? "0" + m : m) + "-" +
      ((date.getDay() < 10) ? "0" + date.getDay() : date.getDay()) + "_" +
      ((date.getHours() < 10) ? "0" + date.getHours() : date.getHours()) + ":" +
      ((date.getMinutes() < 10) ? "0" + date.getMinutes() : date.getMinutes()) + ":" +
      ((date.getSeconds() < 10) ? "0" + date.getSeconds() : date.getSeconds());

    var callno = getValue(holdingData, "call_number");
    if (callno == "") {
      status = "META-CALL";
      status_msg = "Empty call number. ";
    }

    //if (!LOC_REGEX.test(loc)) {
    let locSelected = $('#locSelected option:selected').val();
    if (locSelected != loc) {
      status = (status == "PASS") ? "PULL-LOC" : "PULL-MULT";
      status_msg += LOC_MSG;
    }

    if (process == "LOAN") {
      status = (status == "PASS") ? "PULL-DUE" : "PULL-MULT";
      status_msg += "Item is on LOAN. ";
    } else if (process == "CLAIM RETURNED LOAN") {
      status = (status == "PASS") ? "PULL-DUE" : "PULL-MULT";
      status_msg += "Item is CLAIM RETURNED. ";
    } else if (process == "LOST LOAN") {
      status = (status == "PASS") ? "PULL-DUE" : "PULL-MULT";
      status_msg += "Item is LOST. ";
    } else {
      if (process != "") {
        status = (status == "PASS") ? "PULL-STAT" : "PULL-MULT";
        status_msg += "Item has a process status. ";
      }
    }

    if (tempLoc != "") {
      status = (status == "PASS" || status == "PULL-LOC") ? "PULL-LOC" : "PULL-MULT";
      status_msg += "Item has a temp location. ";
    }


    resdata = {
      "barcode"       : barcode,
      "bib_id"        : getValue(bibData, "mms_id"),
      "holding_id"    : getValue(holdingData, "holding_id"),
      "record_num"    : getValue(itemData, "pid"),
      "location_code" : loc,
      "process"       : process,
      "temp_location" : tempLoc,
      "volume"        : getValue(itemData, "description"),
      "call_number"   : callno,
      "title"         : getValue(bibData, "title"),
      "bibLink"       : bibLink,
      "holdingLink"   : holdingLink,
      "timestamp"     : timestamp,
      "status"        : status,
      "status_msg"    : status_msg
    }
  }
  return resdata;
}

function soundBeep(force) {
  if (force || $('#beep').is(":checked")) {
    frequency = $('#frequency').val();
    volume = $('#volume').val();
    beep(200, frequency, volume);
  }
}

/*
 * Process new rows
 *   show - boolean - whether or not to display the add barcode dialog
 *
 * (1) Look for last row with a class of "new"
 * (2) Change class to "processing"
 * (3) Send barcode to webservice
 * (4) Find relevant table row and load data
 * (5) Remove status of "processing"
 * (6) Set status to the status from the web service
 */
function processCodes(show) {
  if ($("#restable tr.processing").length > 0) return;
  var tr = $("#restable tr.new:last");

  if (tr.length == 0) return;
  tr.removeClass("new").addClass("processing");
  var barcode = tr.attr("barcode");

  //If barcode is invalid, mark with a status of "FAIL"
  if (!isValidBarcode(barcode)) {
    setRowStatus(tr, STAT_FAIL, "Invalid item barcode", show);
    soundBeep(false);
    return;
  }

  //Call the web service to get data for the barcode
  var url = API_REDIRECT + "?apipath="+encodeURIComponent(API_SERVICE)+"items&item_barcode="+barcode;

  $.getJSON(url, function(rawdata){
    var data = parseResponse(getBarcodeFromUrl(this.url), rawdata);
    var resbarcode = data["barcode"];
    var tr = $("#restable tr[barcode="+resbarcode+"]");

    for(key in data) {
      var val = data[key] == null ? "" : data[key];
      if (key == "bibLink" || key == "holdingLink") {
        continue;
      } else if (key == "bib_id" || key == "holding_id") {
        tr.attr(key, val);
      } else {
        tr.find("td."+key).text(val);
      }
    }

    var url = API_REDIRECT + "?apipath=" + encodeURIComponent(data["bibLink"]);
    $.getJSON(url, function(data){
      if ((getValue(data, "suppress_from_publishing") == "true")) {
        $("tr[bib_id=" + data["mms_id"] + "] td.bib_supp")
          .text("X");
        tr.addClass("bib_supp");
      }
      tr.addClass("bib_check");
      updateRowStat(tr);
    });
    url = API_REDIRECT + "?apipath=" + encodeURIComponent(data["holdingLink"]);
    $.ajax({
      url: url,
      type: 'GET',
      dataType: 'json',
      success: function(data, textStatus, jqXHR) {
        var headers = jqXHR.getAllResponseHeaders();
        var headerMap = headersToMap(headers);
        $("#apicalls").text('API calls remaining: ' + headerMap['x-exl-api-remaining']);

        // Handle the JSON response
        if ((getValue(data, "suppress_from_publishing") == "true")) {
          $("tr[holding_id=" + data["holding_id"] + "] td.hold_supp")
            .text("X");
          tr.addClass("hold_supp");
        }
        tr.addClass("hold_check");
        updateRowStat(tr);
      },
      error: function(xhr, status, error) {
        // Handle errors
      }
    });
    setLcSortStat(tr);

    setRowStatus(tr, tr.find("td.status").text(), null, show);
  }).fail(function(jqXHR, textStatus, errorThrown) {
        //console.log("jqXHR " + jqXHR.status);
        //console.log("error " + textStatus);
        //console.log("incoming Text " + jqXHR.responseText);
    // Alma API returns a 400 for item not found, but jqXHR has status of 404. Hmm...
    //<web_service_result xmlns="http://com/exlibris/urm/general/xmlbeans"><errorsExist>true</errorsExist><errorList><error><errorCode>401689</errorCode><errorMessage>No items found for barcode 1111111.</errorMessage><trackingId>E01-0507194331-VBF53-AWAE209511337</trackingId></error></errorList></web_service_result>
    if (jqXHR.status == 404) {
      setRowStatus(tr, "NOT-FOUND", "--", show);
    } else {
      setRowStatus(tr, STAT_FAIL, "Connection Error", show);
    }
  });
}


function headersToMap(headerStr) {
  // Convert the header string into an array
  // of individual headers
  const arr = headerStr.trim().split(/[\r\n]+/);
  // Create a map of header names to values
  const headerMap = {};
  arr.forEach((line) => {
    const parts = line.split(": ");
    const header = parts.shift();
    const value = parts.join(": ");
    headerMap[header] = value;
  });
  return headerMap;
}


/*
 * Evaluate the call number sort of an item based on the previous row that had been added to this table.
 * A CSS class will be assigned to the call number based on a comparison with the prior row.
 *
 * Params
 *   tr - the table row to be evaluated
 *
 * CSS Classes
 *   .lcfirst - no prior element exists in the table
 *   .lcequal - sorted call number matches the prior row
 *   .lcprev  - sorted call number precedes prior row (error condition)
 *   .lcnext  - sorted call number follows prior row (expected condition)
 */
function setLcSortStat(tr) {
  var tdcall = tr.find("td.call_number");
  tdcall.removeClass("lcfirst lcequal lcnext lcprev");
  var call_number = tdcall.text();
  var lcsorter = null;
  let cnType = $('#cnType option:selected').val();
  if (cnType == "dewey") {
    lcsorter = new deweyCallClass();
  } else {
    lcsorter = new locCallClass();
  }
  var normlc = "";
  try {
    normlc = lcsorter.returnNormLcCall(call_number);
  } catch(e) {
  }
  tdcall.attr("title", normlc);

  var prev = tr.next("tr").find("td.call_number").attr("title");
  if (prev == null || prev == "") {
    tdcall.addClass("lcfirst");
  } else if (normlc == prev) {
    tdcall.addClass("lcequal");
  } else if (normlc > prev) {
    tdcall.addClass("lcnext");
  } else {
    tdcall.addClass("lcprev");
    soundBeep();
  }
}


//Check barcode validity - based on institutional barcode use
function isValidBarcode(barcode) {
    return BARCODE_REGEX.test(barcode);
}

//this test is run before adding a barcode
function isDuplicateBarcode(barcode) {
    return ($("tr[barcode="+barcode+"]").length > 0)
}

//Provide user feedback on barcode validity
function valBarcode() {
  var bc = $("#barcode");
  var msg = $("#message");

  bc.addClass("ui-state-error");
  $("button.ui-button:first").attr("disabled", true);

  var v = bc.val();
  if (v == null || v == "") {
    return false;
  } else if (!isValidBarcode(v)) {
    msg.text(BARCODE_MSG);
    return false;
  } else if (isDuplicateBarcode(v)) {
    msg.text("Duplicate barcode");
    return false;
  } else {
    msg.text("Barcode appears to be valid");
    bc.removeClass("ui-state-error");
    $("button.ui-button:first").attr("disabled", false);
    return true;
  }
}

//Show user-friendly modal dialog
//  title - String - dialog title
//  msg   - jQuery - html message to display
//  func  - function - function to execute if user clicks OK
function mydialog(title, mymessage, func) {
  $("#dialog-msg").html(mymessage);
  $("#dialog-msg").dialog({
    resizable: false,
    height: "auto",
    width: 400,
    modal: true,
    title: title,
    buttons: {
      OK: function() {
        $( this ).dialog( "close" );
        func();
      },
      Cancel: function() {
        $( this ).dialog( "close" );
      }
    }
  });
}

function populateLibs() {
  // clear out first
  $('#libSelected')
    .find('option')
    .remove()
    .end();

  var url = API_REDIRECT + "?apipath="+encodeURIComponent(API_SERVICE)+"conf/libraries";

  $.ajax({
    url: url,
    type: 'GET',
    dataType: 'json',
    success: function(json, textStatus, jqXHR) {
      var headers = jqXHR.getAllResponseHeaders();
      var headerMap = headersToMap(headers);
      $("#apicalls").text('API calls remaining: ' + headerMap['x-exl-api-remaining']);

      if ('errorsExist' in json) {
        var status_msg = "--";
        var errorList = getArray(json, "errorList");
        var errorArr = ('error' in errorList) ? errorList["error"] : [];
        if (errorArr.length > 0) {
          var error = errorArr[0];
          status_msg = getValueWithDef(error, 'errorCode', "--") + ": "
          status_msg += getValueWithDef(error, 'errorMessage', "--");
        }
        console.error(status_msg);
      } else {
        var libs = getArray(json, 'library');
        for (let lib of libs) {
          //console.log('lib=' + JSON.stringify(lib.name));
          $('#libSelected').append($('<option>', { 
              value: lib.code,
              text : lib.name
          }));
        }
        $("#libSelected").val($("#location option:first").val()).change();
      }
    },
    error: function(xhr, status, error) {
      // Handle errors
      console.log('Failed to load libraries');
    }
  });

}

function populateLocs() {
  // clear out first
  $('#locSelected')
    .find('option')
    .remove()
    .end();

  let libId = $('#libSelected option:selected').val();
  var url = API_REDIRECT + "?apipath="+encodeURIComponent(API_SERVICE)+"conf/libraries/" + libId + "/locations";

  $.ajax({
    url: url,
    type: 'GET',
    dataType: 'json',
    success: function(json, textStatus, jqXHR) {
      var headers = jqXHR.getAllResponseHeaders();
      var headerMap = headersToMap(headers);
      $("#apicalls").text('API calls remaining: ' + headerMap['x-exl-api-remaining']);

      if ('errorsExist' in json) {
        var status_msg = "--";
        var errorList = getArray(json, "errorList");
        var errorArr = ('error' in errorList) ? errorList["error"] : [];
        if (errorArr.length > 0) {
          var error = errorArr[0];
          status_msg = getValueWithDef(error, 'errorCode', "--") + ": "
          status_msg += getValueWithDef(error, 'errorMessage', "--");
        }
        console.error(status_msg);
      } else {
        var locs = getArray(json, 'location');
        for (let loc of locs) {
          $('#locSelected').append($('<option>', { 
              value: loc.code,
              text : loc.name + ' (' + loc.code + ')'
          }));
        }
  
        $("#locSelected").val($("#location option:first").val()).change();
      }
    },
    error: function(xhr, status, error) {
      // Handle errors
      console.log('Failed to load locations');
    }
  });

}



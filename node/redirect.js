'use strict';

const API_SERVICE = "https://api-na.hosted.exlibrisgroup.com/almaws/v1/";
const express = require('express');
const fs = require('fs');
const ini = require('ini');
const https = require('https');
const axios = require('axios');
const axiosThrottle =require('axios-request-throttle');

const almaApi = axios.create({
  //30 sec timeout
  timeout: 30000,

  //keepAlive pools and reuses TCP connections, so it's faster
  httpsAgent: new https.Agent({ keepAlive: true }),
});

axiosThrottle.use(almaApi, { requestsPerSecond: 20 });


global.orgs = loadOrgs();


function ts_log_access(req) {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  console.log("%s\t%s\t%s", new Date(), ip, req.url);
}

function ts_log_error(req, str) {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  console.log("%s\t%s\t%s\t%s", new Date(), ip, req.url, str);
}

function handleError(res, message, error){
    var errorObject = {
        message: message,
        error: error
    };
    res.status(404);
    res.send(errorObject);
}

function loadOrgs() {
  let orgs = [];

  var propPath = '/var/data/local.prop.orgs';
  const ini_data = ini.parse(fs.readFileSync(propPath, 'utf-8'))

  for (let org of ini_data['orgs']) {
    orgs.push( {
        name: org,
        apikey: ini_data[org]['ALMA_APIKEY'],
        desc: ini_data[org]['DESCRIPTION'],
      }
    );
  }
  //console.log('orgs: ', orgs);
  return orgs;
}

function getApiKey(orgName) {
  return getOrgInfo(orgName, 'apikey');
}

function getOrgInfo(orgName, varName) {
  for (let org of orgs) {
    if (orgName === org['name']) {
      return org[varName];
    }
  }
}

// Constants
const PORT = 80;
const HOST = '0.0.0.0';

const app = express();
app.set("view engine", "pug");


app.get('/org/:org/redirect.js*', async (req, res) => {
  ts_log_access(req);
  var APIKEY = getApiKey(req.params.org);
  //console.log('APIKEY = ' + APIKEY);

  let qs = {
    'apikey': APIKEY
  }
  for(var k in req.query) {
    if (k == "apipath") continue;
    qs[k] = req.query[k];
  }
  try {
    let ret = await almaApi.get(req.query.apipath,
      {
        params: qs,
        headers: {
          'Accept': 'application/json',
        }
      }
    );
    res.json(ret.data);
    
  } catch (error) {
    ts_log_error(req, error);
    handleError(res, error.message);
  }
});

app.get('/org/:org/redirect_items.js*', async (req, res) => {
  ts_log_access(req);
  var APIKEY = getApiKey(req.params.org);
  //console.log('APIKEY = ' + APIKEY);

  let qs = {
    'apikey': APIKEY
  }

  let retData = [];
  let barcodes = req.query.item_barcode;
  console.log('received barcodes: ' + barcodes);
  for (let barcode of req.query.item_barcode) {
      console.log('processing barcode: ' + barcode + ' from [' + barcodes + ']');
      let data = {};
      try {
        let ret = await almaApi.get(API_SERVICE+'items?item_barcode='+barcode,
          {
            params: qs,
            headers: {
              'Accept': 'application/json',
            }
          }
        );
        data = ret.data;
        data["barcode"] = barcode;
  
        if ("link" in data) {
          let linkURL = JSON.stringify(data["bib_data"]["link"]);
          linkURL = linkURL.replace(/^"/, '');
          linkURL = linkURL.replace(/"$/, '');
          try {
            let ret = await almaApi.get(linkURL,
              {
                params: qs,
                headers: {
                  'Accept': 'application/json',
                }
              }
            )
            let bibLinkData = ret.data;
            data["bibLinkData"] = bibLinkData;
          } catch (error) {
            ts_log_error(req, "barcode " + barcode + " couldn't get link data; " + error);
          }
        }
    
        if ("holding_data" in data) {
          let linkURL = JSON.stringify(data["holding_data"]["link"]);
          linkURL = linkURL.replace(/^"/, '');
          linkURL = linkURL.replace(/"$/, '');
          try {
            ret = await almaApi.get(linkURL,
              {
                params: qs,
                headers: {
                  'Accept': 'application/json',
                }
              }
            )
            let holdingLinkData = ret.data;
            data["holdingLinkData"] = holdingLinkData;
          } catch (error) {
            ts_log_error(req, "barcode " + barcode + " couldn't get holding_data data; " + error);
          }
        }
      } catch (error) {
        ts_log_error(req, "barcode " + barcode + " couldn't retrieve data; " + error);
        data = {
          'barcode': barcode,
          'exception': "barcode " + barcode + " couldn't retrieve data; " + error
        }
console.log("Adding EXCEPTION barcode " + barcode + " to return Data");
      }
console.log("Adding barcode " + barcode + " to return Data");
      retData.push(data);
  }

console.log('******returning [' + barcodes + ']');
    res.json(retData);
});

app.get('/org/:org/*', async (req, res) => {
  ts_log_access(req);
  var url = require('url').parse(req.url);
  var urlPath = url.pathname;

  var org = req.params.org;
  var oldUrl = urlPath;
  //console.log('Old url string: ' + oldUrl);
  let regExp = new RegExp('^/org/' + org + '[/]*');
  let newUrl = oldUrl.replace(regExp, '');
  //console.log('New url string: ' + newUrl);
  urlPath = newUrl;

  //console.log('Got url: ' + urlPath);
  //console.log('sendFile: ' + __dirname + "/" + urlPath);

  res.sendFile( __dirname + "/" + urlPath );
});

app.get('/*', async (req, res) => {
  //console.log('orgs:', orgs);
  ts_log_access(req);
  res.render('select', { orgs: orgs });
});

app.timeout = 600000; // load balancer timeout of 600sec
app.listen(PORT, HOST);
console.log(`Running on http://${HOST}:${PORT}`);

// Getting default timeout value
// by using timeout api
const v = app.timeout;
 
// Display the Timeout value
console.log('Default time out value :- ' + v);

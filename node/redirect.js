'use strict';

const express = require('express');
const fs = require('fs');
const ini = require('ini');
const axios = require('axios');

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
    let ret = await axios.get(req.query.apipath,
      {
        params: qs,
        headers: {
          'Accept': 'application/json',
        }
      }
    )
    var apicalls = ret.headers['x-exl-api-remaining'];
    res.set('x-exl-api-remaining', apicalls);
    res.json(ret.data);
    
  } catch (error) {
    ts_log_error(req, error);
    handleError(res, error.message);
  }
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

app.listen(PORT, HOST);
console.log(`Running on http://${HOST}:${PORT}`);

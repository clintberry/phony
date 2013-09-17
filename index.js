
var esl = require('modesl');
var _ = require('lodash');
var csv = require('csv');


function Connection(address, port, password) {
  this.address = address;
  this.port = port || 8021;
  this.password = password || 'ClueCon';

  this.conn = null;
  this.eventArray = [];
  this.dbType = 'sqlite'; // sqlite || postgresql
  this.pendingFunctions = [];
}

Connection.prototype.connect = function(cb) {
  var instance = this;
  instance.conn = new esl.Connection(instance.address, instance.port, instance.password, function() {
    cb(instance.conn);
    // If any event subscriptions exist, subscribe now
    if(instance.eventArray.length) {
      instance.conn.subscribe(instance.eventArray, function(){});
    }
    // If any pending functions exist, call them now
    if(instance.pendingFunctions.length) {
      instance.callPendingFunctions();
    }
    return instance.conn;
  });
}

Connection.prototype.disconnect = function() {
  this.conn.disconnect();
}

Connection.prototype.isConnected = function() {
  return !!this.conn && this.conn.connected();
}

Connection.prototype.callPendingFunctions = function() {
  while(this.pendingFunctions.length) {
    var pendingObj = this.pendingFunctions.shift();
    pendingObj.func(pendingObj.cb);
  }
}

/*************************************************
  Events
**************************************************/

Connection.prototype.subscribe = function(events, cb) {
  if (typeof events == 'string' || events instanceof String) {
    this.eventArray.push(events);
  }
  else if (_.isArray(events)) {
    this.eventArray = _.union(this.eventArray, events);
  }
  else {
    cb('First argument must be event name string, or array of event names');
    return false;
  }
  if(this.isConnected()){
    this.conn.subscribe(this.eventArray, function(){
      cb(null);
    });
  }
}

Connection.prototype.unsubscribe = function(events, cb) {
  if (typeof events == 'string' || events instanceof String) {
    this.eventArray = _.without(this.eventArray, events);
  }
  else if (typeof(events) == 'Array') {
    _.forEach(events, function(value) {
      this.eventArray = _.without(this.eventArray, value);
    });
  }
  else {
    cb('First argument must be event name string, or array of event names');
    return false;
  }
  // No unsubscribe in modesl library just yet. Need to submit a pull request
}

/**
 * Event handler for freeswitch events
 * @param  {String} eventName   Freeswitch event name (e.g. CHANNEL_CREATE, CUSTOME, etc.)
 * @param  {Function} handler   Function to call when event fires
 * @return {Null}               Null
 */
Connection.prototype.on = function(eventName, handler) {
  this.conn.on('esl::event::' + eventName + '::**', function(e) {
    handler(e);
  });
}

/**
 * Advand On event handler for direct access to node-esl event handler
 * @param  {String} eventName  Full event namespace including esl::event:**
 * @param  {Function} handler  Function to call when event fires
 * @return {Null} Null
 */
Connection.prototype.advOn = function(eventName, handler) {
  this.conn.on(eventName, function(e) {
    handler(e);
  });
}

/*************************************************
  Channel Commands
**************************************************/

Connection.prototype.getChannels = function(cb) {
  var instance = this;
  var getChannelsFunc = function(callback) {
    instance.conn.show('channels', 'json', function(err, data) {
      callback(err, data);
    });
  }
  if(this.isConnected()) {
    getChannelsFunc(cb);
  }
  else {
    this.pendingFunctions.push({
      func: getChannelsFunc,
      cb: cb
    });
  }
}

Connection.prototype.getCalls = function(cb) {
  var instance = this;
  var getCalls = function(callback) {
    instance.conn.show('calls', 'json', function(err, data) {
      callback(err, data);
    });
  }
  if(this.isConnected()) {
    getCalls(cb);
  }
  else {
    this.pendingFunctions.push({
      func: getCalls,
      cb: cb
    });
  }
}

/*************************************************
  Sofia Commands
**************************************************/

Connection.prototype.status = function(cb) {
  var instance = this;
  sendApiRequest(instance, 'status', function(data) {
    cb(null, data);
  });
}

Connection.prototype.getProfiles = function(cb) {
  var instance = this;
  var names = [];
  var parsedData = [];
  var parse = function(data) {
    csv().from.string(data, { comment:'=', delimiter: '\t', columns: true, trim: true }).to.array(function(parsedData){
      parsedData.pop();
      cb(null, parsedData);
    });
  }
  sendApiRequest(instance, 'sofia status', parse);
}


Connection.prototype.getUsers = function(profile, cb) {
  var instance = this;
  var users = [];

  // If callback is first argument, get all profiles and check for devices accross all of them
  if(_.isFunction(profile)) {
    cb = profile;
    instance.getProfiles(function(err, profiles) {
      var splicedProfiles = [];
      for(var i=0; i<profiles.length; i++) {
        if(profiles[i]['Type'] == 'profile') {
          splicedProfiles.push(profiles[i]);
        }
      };
      var count=0
      splicedProfiles.forEach(function(profile, index) {
        count++;
        sendApiRequest(instance, 'sofia status profile ' + profile.Name + ' reg', function(data){
          csv().from.string(data, { comment:'==', delimiter: '\t', trim: true, quote: '' }).to.array(function(parsedData){
            parsedData.shift(); // Remove first non-data element
            parsedData.pop(); // Remove blank line
            parsedData.pop(); // Remove the summary at end
            var tempUsers = [];
            var currentUser = {};
            parsedData.forEach(function(namevalue, idx) {
              if(namevalue[0] == 'Call-ID:') {
                if('Call-ID' in currentUser) {
                  tempUsers.push(_.clone(currentUser)); // pushing objects pushes just the reference. Need to clone.
                }
                currentUser = {};
              }
              currentUser[namevalue[0].replace(/:/, "")] = namevalue[1];
            });
            
            // Add the last current user to the list
            if('Call-ID' in currentUser) {
              tempUsers.push(_.clone(currentUser));
            }
            users = users.concat(tempUsers);
            count--;
            if(count == 0) {
              cb(null, users);
            }
          });
        });
      });
    });
  }
}

function sendApiRequest(instance, apiCommand, cb) {
  var tempFunction = function(callback) {
    instance.conn.bgapi(apiCommand, function(res) {
      //console.log(res.getBody());
      callback(res.getBody());
    });
  }
  if(instance.isConnected()) {
    tempFunction(cb);
  }
  else {
    instance.pendingFunctions.push({
      func: tempFunction,
      cb: cb
    });
  }
}


module.exports = {
  Connection: Connection
};
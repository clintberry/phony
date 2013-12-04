
var esl = require('modesl');
var _ = require('lodash');
_.str = require('underscore.string');
var csv = require('csv');
var logger = null;
var sprintf = require('sprintf');


function Connection(address, port, password) {
  this.address = address;
  this.port = port || 8021;
  this.password = password || 'ClueCon';

  this.conn = null;
  this.eventArray = [];
  this.dbType = 'sqlite'; // sqlite || postgresql
  this.functionQueue = [];
}

Connection.prototype.connect = function(cb) {
  var instance = this;
  log('debug', 'Attempting to connect to FS event socket at ' + instance.address + ':' + instance.port)
  instance.conn = new esl.Connection(instance.address, instance.port, instance.password, function() {
    log('info', 'Connected to FS event socket at ' + instance.address + ':' + instance.port);
    cb(instance.conn);
    // If any event subscriptions exist, subscribe now
    if(instance.eventArray.length) {
      instance.conn.subscribe(instance.eventArray, function(){});
    }
    instance.eventArray.push = function(event) {
      instance.eventArray.prototype.push(event);
      instance.conn.subscribe(instance.eventArray, function(){});
    }
    // If any pending functions exist, call them now
    if(instance.functionQueue.length) {
      instance.callfunctionQueue();
    }
    return instance.conn;
  });
};


Connection.prototype.setLogger = function(newLogger) {
  logger = newLogger || {
    log: function(level, message) {
      console.log(level + ': ' + message);
    }
  };
};

Connection.prototype.disconnect = function() {
  this.conn.disconnect();
};

Connection.prototype.isConnected = function() {
  return !!this.conn && this.conn.connected();
};

Connection.prototype.callfunctionQueue = function() {
  while(this.functionQueue.length) {
    var pendingObj = this.functionQueue.shift();
    pendingObj();
  }
  // Once we have all the functions executed, overwrite push function to just execute passed functions
  this.functionQueue.push = function(callMe) {
    callMe();
  }
};

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
  var instance = this;
  // this.functionQueue.push(function(){
  //   instance.conn.subscribe(instance.eventArray, function(){
  //     cb(null);
  //   });
  // });
};

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
};

/**
 * Event handler for freeswitch events
 * @param  {String} eventName   Freeswitch event name (e.g. CHANNEL_CREATE, CUSTOME, etc.)
 * @param  {Function} handler   Function to call when event fires
 * @return {Null}               Null
 */
Connection.prototype.on = function(eventName, handler) {
  var instance = this;
  if(_.indexOf(instance.eventArray, eventName) == -1) {
    instance.eventArray.push(eventName);
  }
  instance.functionQueue.push(function(){
    instance.conn.on('esl::event::' + eventName + '::**', function(e) {
      handler(e);
    });
  });
};

/**
 * Advand On event handler for direct access to node-esl event handler
 * @param  {String} eventName  Full event namespace including esl::event:**
 * @param  {Function} handler  Function to call when event fires
 * @return {Null} Null
 */
Connection.prototype.advOn = function(eventName, handler) {
  instance.functionQueue.push(function(){
    this.conn.on(eventName, function(e) {
      handler(e);
    });
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
  this.functionQueue.push(function(){
    getChannelsFunc(cb);
  });
}

Connection.prototype.getCalls = function(cb) {
  var instance = this;
  var getCalls = function(callback) {
    instance.conn.show('calls', 'json', function(err, data) {
      callback(err, data);
    });
  }
  this.functionQueue.push(function(){
    getCalls(cb);
  });
}


Connection.prototype.callNumber = function(user, number, options, cb) {
  var instance = this;
  if(_.isFunction(options)) {
    cb = options;
    options = null;
  }

  var channelVars = '';

  if(options && _.isObject(options)) {
    if(_.has(options, 'channelVars')) {
      channelVars = '[';
      _.each(options.channelVars, function(val, key) {
        channelVars = channelVars + key + "=" + val + ','; 
      });
      channelVars = channelVars.slice(0, -1) + ']';
    }
  }

  var dialString = sprintf(channelVars + 'user/%(user)s %(number)s', { user: user, number: number});
  log('debug', 'Dialstring: ' + dialString);

  sendApiRequest(instance, 'originate', dialString, function(res) {
    if(res.indexOf('+OK') !== 0) {
      cb("Error creating call: " + res);
    }
    else {
      var uuid = _.str.trim(res.slice(4));
      cb(null, { uuid: uuid });
    }
  });
}

Connection.prototype.callHold = function(uuid, cb) {
  var instance = this;
  sendApiRequest(instance, 'uuid_phone_event', uuid + " hold", function(res) {
    if(res.indexOf('+OK') !== 0) {
      cb("Error holding call: " + res);
    }
    else {
      cb(null, { res: res });
    }
  });
}

Connection.prototype.callResume = function(uuid, cb) {
  var instance = this;
  sendApiRequest(instance, 'uuid_phone_event', uuid + " talk", function(res) {
    if(res.indexOf('+OK') !== 0) {
      cb("Error resuming call: " + res);
    }
    else {
      cb(null, { res: res });
    }
  });
}

Connection.prototype.callEnd = function(uuid, cb) {
  var instance = this;
  sendApiRequest(instance, 'uuid_kill', uuid, function(res) {
    if(res.indexOf('+OK') !== 0) {
      cb("Error ending call: " + res);
    }
    else {
      cb(null, { res: res });
    }
  });
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

function sendApiRequest(instance, apiCommand, args, cb) {
  if(_.isFunction(args)) {
    cb = args;
    args = null;
  }
  var tempFunction = function(callback) {
    instance.conn.bgapi(apiCommand, args, function(res) {
      //log(res.getBody());
      callback(res.getBody());
    });
  }
  instance.functionQueue.push(function(){
    tempFunction(cb);
  });
}

function log(level, message) {
  if(logger) {
    if(typeof message == 'undefined') {
      message = level;
      level = 'debug';
    }
    logger.log(level, message);
  } 
}


module.exports = {
  Connection: Connection
};
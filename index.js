
var esl = require('modesl');
var _ = require('lodash');



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
  else if (typeof(events) == 'Array') {
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
    })
  }
  else {
    cb('First argument must be event name string, or array of event names');
    return false;
  }
  // No unsubscribe in modesl library just yet. Need to submit a pull request
}

Connection.prototype.on = function(eventName, handler) {
  this.conn.on('esl::event::' + eventName + '::**', function(e) {
    handler(e);
  });
}

/*************************************************
  Channels
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




module.exports = {
  Connection: Connection
};
/**
 *
 * Microline Zont adapter
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

const PATH_CONNECT = '/api/devices',
      PATH_DEVICES = '/api/devices',
      DEV_ZONT_H = 'T102'; // ZONT H-2 Домашний Wi-Fi-термостат

// you have to require the utils module and call adapter function
var utils = require(__dirname + '/lib/utils'); // Get common adapter utils
var http  = require('https');

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.zont.0
var adapter = utils.adapter('zont');

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed object changes
adapter.on('objectChange', function (id, obj) {
    // Warning, obj can be null if it was deleted
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    // Warning, state can be null if it was deleted
    adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));

    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        adapter.log.info('ack is not set!');
    }
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function (obj) {
    if (typeof obj == 'object' && obj.message) {
        switch (obj.command) {
            case 'send':
                // e.g. send email or pushover or whatever
                console.log('send command');
                // Send response in callback if required
                if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
                break;
            case 'connectToZont':
                if (obj && obj.message && typeof obj.message == 'object') {
                    connectToZont(obj.message.username, obj.message.password, function (res) {
                        adapter.sendTo(obj.from, obj.command, res, obj.callback);
                    });
                }
                break;
            default:
                adapter.log.warn('Unknown message: ' + JSON.stringify(obj));
                break;
        }
    }
    processMessages();
});


function requestToZont(path, data, success, failure, user, pass) {
    var options, auth,
        username = user || adapter.config.username || '',
        password = pass || adapter.config.password || '';
    auth = username+':'+password;
    options = {
        host: 'zont-online.ru',
        path: path,
        method: 'POST',
        headers: {
            'Authorization': 'Basic '+new Buffer(auth).toString('base64'),
            'X-ZONT-Client': username,
            'Content-Type': 'application/json'
        }
    };
    var r = http.request(options, function (res) {
        var message = '', data = '';
        res.on('data', (chunk) => {
            message += chunk;
        });
        res.on('end', function() {
            try {
                data = JSON.parse(message);
            } catch (err) {
                adapter.log.error('Cannot parse: ' + message);
                if (failure) failure(res, message);
                return;
            }
            if (res.statusCode == 200) {
                if (success) success(res, data);
            } else {
                if (failure) failure(res, data);
            }
        });
    });
    r.on('error', function (res) {
        adapter.log.error('zont request failure: '+res.message);
        if (failure) failure(res);
    });
    r.end();
}


function connectToZont(username, password, callback){
    var options, auth;
    if (!username) {
        username = adapter.config.username;
        password = adapter.config.password;
    }
    if (username) {
        adapter.log.info('try to connect to zont-online '+username);
        requestToZont(PATH_CONNECT, null, function (res, data) {
            adapter.log.info('statusCode: ' + res.statusCode);
            adapter.log.info('statusMessage: ' + res.statusMessage);
            adapter.log.info('headers: ' + res.headers);
            adapter.log.info(data);
            if (callback) {
                if (res.statusCode == 200) {
                    callback('ok');
                } else {
                    callback({error: 'zont request '+res.statusCode+': '+res.statusMessage});
                }
            }
        }, function (res, data) {
            if (data) {
                adapter.log.error('zont request error: '+res.statusCode+': '+res.statusMessage);
                if (callback) callback({error: 'zont request '+res.statusCode+': '+res.statusMessage});
            } else {
                adapter.log.error('zont request status message: '+res.message);
                if (callback) callback({error: res.message});
            }
        }, username, password);
    }
}


// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    main();
});


function processMessages(ignore) {
    adapter.getMessage(function (err, obj) {
        if (obj) {
            if (!ignore && obj && obj.command == 'send') processMessage(obj.message);
            processMessages();
        }
    });
}


// Because the only one port is occupied by first instance, the changes to other devices will be send with messages
function processMessage(message) {
    if (typeof message === 'string') {
        try {
            message = JSON.parse(message);
        } catch (err) {
            adapter.log.error('Cannot parse: ' + message);
            return;
        }
    }
}


function syncObjects(){
    pollStatus();
    setInterval(pollStatus, adapter.config.pollInterval * 1000);
}

function pollStatus(dev) {
    connectToZont(null, null, function (res) {
        if (res == 'ok') {
            adapter.setState('info.connection', true, true);
        } else {
            adapter.setState('info.connection', false, true);
            if (res && res.error) {
                adapter.log.error(res.error);
            }
            return;
        }
        // список устройств
        requestToZont(PATH_DEVICES, null, function (res, data) {
            for (var i = 0; i < data['devices'].length; i++) {
                var dev = data['devices'][i],
                    dev_id = dev['id'],
                    dev_type = dev['device_type']['code'],
                    dev_type_name = dev['device_type']['name'],
                    dev_name = dev['name'],
                    obj_name = adapter.namespace + '.' + dev_type+'_' + dev_id;
                // канал для каждого устройства
                adapter.setObjectNotExists(obj_name, {
                    type: 'channel',
                    common: {name: dev_name},
                    native: dev
                }, {});
                // термометры
                if (dev_type == DEV_ZONT_H) {
                    for (var j = 0; j < dev['thermometers'].length; j++) {
                        var term = dev['thermometers'][j],
                            term_id = term['uuid'],
                            term_name = term['name'],
                            enabled = term['is_assigned_to_slot'],
                            state_name = obj_name + '.' + 'therm_' + term_id,
                            state_val = term['last_value'];
                        if (enabled) {
                            adapter.setObjectNotExists(state_name, {
                                type: 'state',
                                common: {name: term_name},
                                native: term
                            }, {});
                            adapter.setState(state_name, state_val, true);
                        }
                    }
                }
            }
        });
    });
}

function main() {
    adapter.setState('info.connection', false, true);

    // The adapters config (in the instance object everything under the attribute "native") is accessible via
    // adapter.config:
    adapter.log.info('config username: ' + adapter.config.username);
    //adapter.log.info('config password: ' + adapter.config.password);

    syncObjects();

    // in this template all states changes inside the adapters namespace are subscribed
    adapter.subscribeStates('*');

    processMessages(true);
}

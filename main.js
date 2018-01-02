/**
 *
 * Microline Zont adapter
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

const PATH_DEVICES = '/api/devices',
      PATH_LOADDATA = '/api/load_data';


// you have to require the utils module and call adapter function
var utils = require(__dirname + '/lib/utils'); // Get common adapter utils
var http  = require('https');

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.zont.0
var adapter = utils.adapter('zont');


function hasElement(array, value){
    return array.indexOf( value ) != -1;
}

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
    //adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));

    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        // установка значения пользователем
        //adapter.log.info('ack is not set!');
        adapter.log.info('User stateChange ' + id + ' ' + JSON.stringify(state));
        // siren
        // guard-state
        // engine-block
        // webasto 
        // auto-ignition
        // term_
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
        password = pass || adapter.config.password || '',
        postData = JSON.stringify(data);
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
                if (failure) {
                    failure(res, data);
                } else {
                    adapter.log.error(res.statusMessage);
                }
            }
        });
    });
    r.on('error', function (res) {
        adapter.log.error('zont request failure: '+res.message);
        if (failure) failure(res);
    });
    if (data) {
        r.write(postData);
        //adapter.log.info(postData);
    }
    r.end();
}


function connectToZont(username, password, callback){
    var options, auth;
    if (!username) {
        username = adapter.config.username;
        password = adapter.config.password;
    }
    if (username) {
        //adapter.log.info('try to connect to zont-online '+username);
        requestToZont(PATH_DEVICES, null, function (res, data) {
            //adapter.log.info('statusCode: ' + res.statusCode);
            //adapter.log.info('statusMessage: ' + res.statusMessage);
            //adapter.log.info('headers: ' + JSON.stringify(res.headers));
            //adapter.log.info(JSON.stringify(data));
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


function updateState(id, name, value) {
    adapter.setObjectNotExists(id, {type: 'state', common: {name: name, role: 'value'}});
    adapter.setState(id, value, true);
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
        requestToZont(PATH_DEVICES, {load_io: true}, function (res, data) {
            //adapter.log.info(JSON.stringify(data));
            for (var i = 0; i < data['devices'].length; i++) {
                var dev = data['devices'][i],
                    dev_id = dev['id'],
                    dev_type = dev['device_type']['code'],
                    dev_type_name = dev['device_type']['name'],
                    dev_name = dev['name'],
                    obj_name = adapter.namespace + '.' + dev_type+'_' + dev_id,
                    capa = dev['capabilities'];
                // канал для каждого устройства
                adapter.setObjectNotExists(obj_name, {
                    type: 'channel',
                    common: {name: dev_name},
                    native: dev
                }, {});
                updateState(obj_name + '.is_active', 'Активность', dev['is_active']);
                updateState(obj_name + '.online', 'На связи', dev['online']);
                // управление отоплением
                processTermDev(obj_name, dev);

                if (hasElement(capa, "has_guard_state")) {
                    updateState(obj_name + '.guard', 'Охрана', dev['io']['guard-state']);
                }
                if (hasElement(capa, "has_siren_control")) {
                    updateState(obj_name + '.siren', 'Сирена', dev['io']['siren']);
                }
                // авто
                processAutoDev(obj_name, dev);
            }
        });
    });
}


function processTermDev(dev_obj_name, data) {
    let capa = data['capabilities'];
    // термостат
    if (hasElement(capa, "has_thermostat")) {
        updateState(dev_obj_name + '.' + 'thermostat_mode', 'Режим термостата', data['thermostat_mode']);
        if (data['thermostat_mode_temps']) {
            updateState(dev_obj_name + '.' + 'thermostat_temp', 'Целевая температура режима',
                data['thermostat_mode_temps'][data['thermostat_mode']]);
        }
    }
    // термометры
    if (hasElement(capa, "has_thermometer_functions")) {
        for (let j = 0; j < data['thermometers'].length; j++) {
            let term = data['thermometers'][j],
                term_id = term['uuid'],
                term_name = term['name'],
                enabled = term['is_assigned_to_slot'],
                state_name = dev_obj_name + '.' + 'therm_' + term_id,
                state_val = term['last_value'];
            if (enabled) {
                updateState(state_name, term_name, state_val);
            }
        }
    }

    // OT
    if (data['ot_enabled'] != undefined) {
        updateState(dev_obj_name + '.' + 'ot_enabled', 'OpenTherm активен', data['ot_enabled']);
    }

    if (hasElement(capa, "has_thermostat")) {
        let term = data['io']['last-boiler-state'],
            ot = data['io']['ot_state'],
            state_name = dev_obj_name + '.';

        if (term['boiler_work_time'] != undefined) {
            updateState(state_name+'boiler_work_time', 'Время работы котла, сек', term['boiler_work_time']);
        }
        if (term['target_temp'] != undefined) {
            updateState(state_name+'target_temp', 'Целевая температура', term['target_temp']);
        }
        if (term['pza_t'] != undefined) {
            updateState(state_name+'pza_t', 'Расчётная температура ПЗА', term['pza_t']);
        }
        if (term['dhw_t'] != undefined) {
            updateState(state_name+'dhw_t', 'Заданная температура ГВС', term['dhw_t']);
        }
        if (term['power'] != undefined) {
            updateState(state_name+'power', 'Наличие питания', term['power']);
        }
        if (term['fail'] != undefined) {
            updateState(state_name+'fail', 'Авария котла', term['fail']);
        }
        if (ot && ot['cs'] != undefined) {
            updateState(state_name+'ot_cs', 'OT Заданная t° воды', ot['cs']);
        }
        if (ot && ot['bt'] != undefined) {
            updateState(state_name+'ot_bt', 'OT Фактическая t° воды', ot['bt']);
        }
        if (ot && ot['dt'] != undefined) {
            updateState(state_name+'ot_dt', 'OT Фактическая t° ГВС', ot['dt']);
        }
        if (ot && ot['rml'] != undefined) {
            updateState(state_name+'ot_rml', 'OT Уровень модуляции горелки', ot['rml']);
        }
        if (ot && ot['rwt'] != undefined) {
            updateState(state_name+'ot_rwt', 'OT Температура обратного потока', ot['rwt']);
        }
        if (ot && ot['ot'] != undefined) {
            updateState(state_name+'ot_ot', 'OT Уличная температура', ot['ot']);
        }
        if (ot && ot['wp'] != undefined) {
            updateState(state_name+'ot_wp', 'OT Давление носителя', ot['wp']);
        }
        if (ot && ot['fr'] != undefined) {
            updateState(state_name+'ot_fr', 'OT Скорость потока ГВС', ot['fr']);
        }
        if (ot && ot['s'] && ot['s'].length > 0) {
            /*"f" – авария
            "ch" – отопление включено
            "dhw" – ГВС включено
            "fl" – горелка работает
            "cl" – охлаждение работает
            "ch2" – второй контур отопления включен
            "di" – диагностическая индикация*/
            updateState(state_name+'ot_s', 'OT Горелка активна', hasElement(ot['s'], 'fl'));
        }
        if (ot && ot['ff'] != undefined) {
            updateState(state_name+'ot_ff', 'OT Код ошибки', ot['ff'].c);
        }
    }
    
    // // получим данные за последнюю минуту
    // let maxmoment = Math.floor(Date.now() / 1000);
    // let minmoment = maxmoment - 60;

    // requestToZont(PATH_LOADDATA, {requests: [{device_id: data['id'], data_types: ['thermostat_work', 'custom_controls', 'temperature'], mintime: minmoment, maxtime: maxmoment}]}, 
    //     function (res, data) {
    //         adapter.log.info(JSON.stringify(data));
    //         for (let i = 0; i < data['responses'].length; i++) {
    //             let term = data['responses'][i]['thermostat_work'],
    //                 ot = term['ot'],
    //                 state_name = dev_obj_name + '.';
    //             if (term['boiler_work_time'] && term['boiler_work_time'].length > 0) {
    //                 updateState(state_name+'boiler_work_time', 'Время работы котла, сек', term['boiler_work_time'][0][1]);
    //             }
    //             if (term['target_temp']) {
    //                 updateState(state_name+'target_temp', 'Целевая температура', term['target_temp'][0][1]);
    //             }
    //             if (term['pza_t'] != undefined) {
    //                 updateState(state_name+'pza_t', 'Расчётная температура ПЗА', term['pza_t']);
    //             }
    //             if (term['dhw_t'] != undefined) {
    //                 updateState(state_name+'dhw_t', 'Заданная температура ГВС', term['dhw_t']);
    //             }
    //             if (term['power']) {
    //                 updateState(state_name+'power', 'Наличие питания', term['power'][0][1]);
    //             }
    //             if (term['fail']) {
    //                 updateState(state_name+'fail', 'Авария котла', term['fail'][0][1]);
    //             }
    //             if (ot && ot['cs']) {
    //                 updateState(state_name+'ot_cs', 'OT Заданная t° воды', ot['cs'][0][1]);
    //             }
    //             if (ot && ot['bt']) {
    //                 updateState(state_name+'ot_bt', 'OT Фактическая t° воды', ot['bt'][0][1]);
    //             }
    //             if (ot && ot['dt']) {
    //                 updateState(state_name+'ot_dt', 'OT Фактическая t° ГВС', ot['dt'][0][1]);
    //             }
    //             if (ot && ot['rml']) {
    //                 updateState(state_name+'ot_rml', 'OT Уровень модуляции горелки', ot['rml'][0][1]);
    //             }
    //             if (ot && ot['rwt']) {
    //                 updateState(state_name+'ot_rwt', 'OT Температура обратного потока', ot['rwt'][0][1]);
    //             }
    //             if (ot && ot['ot']) {
    //                 updateState(state_name+'ot_ot', 'OT Уличная температура', ot['ot'][0][1]);
    //             }
    //             if (ot && ot['wp']) {
    //                 updateState(state_name+'ot_wp', 'OT Давление носителя', ot['wp'][0][1]);
    //             }
    //             if (ot && ot['fr']) {
    //                 updateState(state_name+'ot_fr', 'OT Скорость потока ГВС', ot['fr'][0][1]);
    //             }
    //             if (ot && ot['s'] && ot['s'].length > 0) {
    //                 updateState(state_name+'ot_s', 'OT Горелка активна', hasElement(ot['s'][0][1], 'fl'));
    //             }
    //             if (ot && ot['ff']) {
    //                 updateState(state_name+'ot_ff', 'OT Код ошибки', ot['ff'][0][1].c);
    //             }
    //             // custom_controls
    //         }
    //     }
    // );
}

function processAutoDev(dev_obj_name, data) {
    let state_name = dev_obj_name + '.',
        io = data['io'],
        capa = data['capabilities'];
    // автомобильные сенсоры
    if (hasElement(capa, "has_car_sensors")) { 
        if (io['door-1'] != undefined) {
            updateState(state_name+'door_1', 'Дверь 1 открыта', io['door-1']);
        }
        if (io['door-2'] != undefined) {
            updateState(state_name+'door_2', 'Дверь 2 открыта', io['door-2']);
        }
        if (io['door-3'] != undefined) {
            updateState(state_name+'door_3', 'Дверь 3 открыта', io['door-3']);
        }
        if (io['door-4'] != undefined) {
            updateState(state_name+'door_4', 'Дверь 4 открыта', io['door-4']);
        }
        if (io['doors'] != undefined) {
            updateState(state_name+'doors', 'Двери открыты', io['doors']);
        }
        if (io['trunk'] != undefined) {
            updateState(state_name+'trunk', 'Багажник открыт', io['trunk']);
        }
        if (io['hood'] != undefined) {
            updateState(state_name+'hood', 'Капот открыт', io['hood']);
        }
        if (io['hood-trunk'] != undefined) {
            updateState(state_name+'hood_trunk', 'Капот или багажник открыт', io['hood-trunk']);
        }
    }
    if (hasElement(capa, "has_engine_block") && io['engine-block'] != undefined) {
        updateState(state_name+'engine_block', 'Блокировка двигателя', io['engine-block']);
    }
    if (hasElement(capa, "has_webasto") && io['webasto'] != undefined) {
        updateState(state_name+'webasto', 'Предпусковой подогреватель (webasto)', io['webasto']);
    }
    if (hasElement(capa, "has_autostart")) {
        if (io['auto-ignition'] != undefined) {
            updateState(state_name+'auto_ignition', 'Автозапуск', io['auto-ignition']['state']);
        }
        if (io['ignition-state'] != undefined) {
            updateState(state_name+'ignition_state', 'Двигатель запущен', io['ignition-state']);
        }
    }
    if (hasElement(capa, "has_voltage_sensor") && io['voltage'] != undefined) {
        updateState(state_name+'voltage', 'Напряжение питания', io['voltage']);
    }
    // температурные сенсоры
    if (hasElement(capa, "has_temperature_sensors") && io['temperature'] && io['temperature'].length > 0) {
        for (let i = 0; i < data['temperature_conf']['assignments'].length; i++){
            let ttype = data['temperature_conf']['assignments'][i],
                val = io['temperature'][i].value;
            switch(ttype) {
                case 'engine':
                    updateState(state_name+'temp_engine', 'Температура двигателя', val);
                    break;
                case 'cabin':
                    updateState(state_name+'temp_cabin', 'Температура салона', val);
                    break;
                case 'outside':
                    updateState(state_name+'temp_outside', 'Температура снаружи', val);
                    break;
            }
        }
    }
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

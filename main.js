/**
 *
 * Microline Zont adapter
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

const PATH_DEVICES = '/api/devices',
      PATH_LOADDATA = '/api/load_data',
      PATH_UPDATE = '/api/update_device',
      PATH_IOPORT = '/api/set_io_port',
      PATH_Z3K_UPDATE = '/api/send_z3k_command',
      BATTERY_DEFAULT_VOLTAGE = 3;


// you have to require the utils module and call adapter function
var utils = require('@iobroker/adapter-core'); // Get common adapter utils
var http  = require('https');

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.zont.0
var adapter = utils.adapter('zont');


function hasElement(array, value){
    return array.indexOf( value ) != -1;
}

Array.prototype.getLastElement = function() {
    return this[this.length-1];
}


// let's declare global heating objects
let heatingCircuits = {}
let heatingModes = {}
let heatingZones = {}


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
    // adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
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
        // thermostat_mode
        // thermostat_temp
        let dev_id = id.split('.')[2].split('_')[1];
        let state_name = id.split('.')[3];
        let new_config;
        switch (true) {
            // ZONT H-2000+
            case state_name == 'heatingCircuits':

                let idArray = id.split('.');
                let circuitId = idArray[4].split('_').getLastElement();
                let param = 'state';
                if (idArray.length > 5) {
                    param = idArray[idArray.length - 1];
                }
                if (param == 'target_temp') {
                    new_config = {
                        device_id: Number(dev_id),
                        "command_name":"TargetTemperature",
                        "object_id":Number(circuitId),
                        "command_args":{"value": Number(state.val)},
                        "request_time":true,
                        "is_guaranteed":true,
                    };
                }
                if (param == 'state') {
                    for (let mode in heatingModes){
                        if(heatingModes[mode]['circuit_on'] && circuitId == heatingModes[mode]['circuit_on'] && state.val == 1) {
                            circuitId = mode;
                        }
                        if(heatingModes[mode]['circuit_off'] && circuitId == heatingModes[mode]['circuit_off'] && state.val == 0) {
                            circuitId = mode;
                        }
                    }
                    new_config = {
                        device_id: Number(dev_id),
                        'object_id': Number(circuitId),
                        'command_name':'SelectHeatingMode',
                        'command_args':null,
                        'is_guaranteed':false,
                        'request_time':true,
                    };
                }
                requestToZont(PATH_Z3K_UPDATE, new_config,
                    function (res, data) {
                        adapter.log.debug('update response: '+JSON.stringify(data));
                        pollStatus();
                    }
                );
                break;

            // режим термостата
            case state_name == 'thermostat_mode':
                new_config = {device_id: dev_id, thermostat_mode: state.val};
                adapter.log.debug('update request: '+JSON.stringify(new_config));
                requestToZont(PATH_UPDATE, new_config, 
                    function (res, data) {
                        adapter.log.debug('update response: '+JSON.stringify(data));
                        pollStatus();
                    }
                );
                break;
            case state_name == 'thermostat_ext_mode':
                new_config = {device_id: dev_id, thermostat_ext_mode: state.val};
                adapter.log.debug('update request: '+JSON.stringify(new_config));
                requestToZont(PATH_UPDATE, new_config, 
                    function (res, data) {
                        adapter.log.debug('update response: '+JSON.stringify(data));
                        pollStatus();
                    }
                );
                break;
            // температура зон
            case state_name.startsWith('target_temp__'):
                let prts = state_name.split('__');
                // значит есть зоны
                if (prts.length > 1) {
                    new_config = {device_id: dev_id, thermostat_target_temps: {}};
                    new_config.thermostat_target_temps[prts[1]] = {manual: true, temp: state.val};
                    adapter.log.debug('update request: '+JSON.stringify(new_config));
                    requestToZont(PATH_UPDATE, new_config, 
                        function (res, data) {
                            adapter.log.debug('update response: '+JSON.stringify(data));
                            pollStatus();
                        }
                    );
                }
                break;
            // температура режимов
            case state_name.startsWith('thermostat_temp'):
                let parts = state_name.split('__');
                // значит есть зоны
                if (parts.length > 2) {
                    new_config = {device_id: dev_id, thermostat_ext_modes_config: {}};
                    new_config.thermostat_ext_modes_config[parts[1]] = {zone_temp: {}};
                    new_config.thermostat_ext_modes_config[parts[1]].zone_temp[parts[2]] = state.val;
                    adapter.log.debug('update request: '+JSON.stringify(new_config));
                    requestToZont(PATH_UPDATE, new_config, 
                        function (res, data) {
                            adapter.log.debug('update response: '+JSON.stringify(data));
                            pollStatus();
                        }
                    );
                } else {
                    new_config = {device_id: dev_id, thermostat_mode_temps: {}};
                    new_config.thermostat_mode_temps[parts[1]] = state.val;
                    adapter.log.debug('update request: '+JSON.stringify(new_config));
                    requestToZont(PATH_UPDATE, new_config, 
                        function (res, data) {
                            adapter.log.debug('update response: '+JSON.stringify(data));
                            pollStatus();
                        }
                    );
                }
                break;
            // охрана
            case state_name == 'guard':
                new_config = {device_id: dev_id, portname: 'guard-state', type: 'string', value: (state.val) ? 'enabled' : 'disabled'};
                adapter.log.debug('guard request: '+JSON.stringify(new_config));
                requestToZont(PATH_IOPORT, new_config, 
                    function (res, data) {
                        adapter.log.debug('guard response: '+JSON.stringify(data));
                        setTimeout(()=>{pollStatus()}, 3000);
                    }
                );
                break;
            // сирена
            case state_name == 'siren':
                new_config = {device_id: dev_id, portname: 'siren', type: 'bool', value: state.val};
                adapter.log.debug('siren request: '+JSON.stringify(new_config));
                requestToZont(PATH_IOPORT, new_config, 
                    function (res, data) {
                        adapter.log.debug('siren response: '+JSON.stringify(data));
                        setTimeout(()=>{pollStatus()}, 3000);
                    }
                );
                break;
            // блокировка двигателя
            case state_name == 'engine_block':
                new_config = {device_id: dev_id, portname: 'engine-block', type: 'bool', value: state.val};
                adapter.log.info('engine_block request: '+JSON.stringify(new_config));
                requestToZont(PATH_IOPORT, new_config, 
                    function (res, data) {
                        adapter.log.debug('engine_block response: '+JSON.stringify(data));
                        setTimeout(()=>{pollStatus()}, 3000);
                    }
                );
                break;
            // webasto 
            case state_name == 'webasto':
                new_config = {device_id: dev_id, portname: 'webasto', type: 'bool', value: state.val};
                adapter.log.debug('webasto request: '+JSON.stringify(new_config));
                requestToZont(PATH_IOPORT, new_config, 
                    function (res, data) {
                        adapter.log.debug('webasto response: '+JSON.stringify(data));
                        setTimeout(()=>{pollStatus()}, 3000);
                    }
                );
                break;
            // Автозапуск 
            case state_name == 'auto_ignition':
                // если это логическое значение
                if (typeof state.val == 'boolean') {
                    new_config = {device_id: dev_id, portname: 'auto-ignition', type: 'bool', value: (state.val) ? 'engine' : 'disabled'};
                } else {
                    new_config = {device_id: dev_id, portname: 'auto-ignition', type: 'auto-ignition', value: {state: state.val}};
                }
                adapter.log.debug('auto_ignition request: '+JSON.stringify(new_config));
                requestToZont(PATH_IOPORT, new_config, 
                    function (res, data) {
                        adapter.log.debug('auto_ignition response: '+JSON.stringify(data));
                        setTimeout(()=>{pollStatus()}, 3000);
                    }
                );
                break;
        }
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
        adapter.log.debug(postData);
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
        adapter.log.debug('try to connect to zont-online '+username);
        requestToZont(PATH_DEVICES, null, function (res, data) {
            adapter.log.debug('statusCode: ' + res.statusCode);
            adapter.log.debug('statusMessage: ' + res.statusMessage);
            adapter.log.debug('headers: ' + JSON.stringify(res.headers));
            adapter.log.debug(JSON.stringify(data));
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


function updateState(id, name, value, common) {
    let new_common = {
            name: name, 
            role: 'value',
            read: true,
            write: (common != undefined && common.write == undefined) ? false : true
        };
    if (common != undefined) {
        if (common.type != undefined) {
            new_common.type = common.type;
        }
        if (common.unit != undefined) {
            new_common.unit = common.unit;
        }
        if (common.states != undefined) {
            new_common.states = common.states;
        }
    }
    adapter.getObject(id, (err, obj) => {
        if (obj) {
            delete new_common.name;
            delete new_common.role;
        }
        adapter.extendObject(id, {type: 'state', common: new_common}, () => {
            if (value !== undefined) {
                adapter.setState(id, value, true);
            }
        });
    });
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
            adapter.log.debug(JSON.stringify(data));
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
                    type: 'device',
                    common: {name: dev_name},
                    native: dev
                }, {});
                updateState(obj_name + '.is_active', 'Активность', dev['is_active'], {type: 'boolean'});
                updateState(obj_name + '.online', 'На связи', dev['online'], {type: 'boolean'});
                // управление отоплением
                processTermDev(obj_name, dev);

                if (hasElement(capa, "has_guard_state")) {
                    updateState(obj_name + '.guard', 'Охрана', (dev['io']['guard-state'] == 'enabled'), {type: 'boolean', write: true});
                }
                if (hasElement(capa, "has_siren_control")) {
                    updateState(obj_name + '.siren', 'Сирена', dev['io']['siren'], {type: 'boolean', write: true});
                }
                if (hasElement(capa, "has_gsm")) {
                    if (hasElement(capa, "has_gsm_balance") && dev['balance']) {
                        updateState(obj_name + '.gsm_balance', 'GSM Баланс', dev['balance'].value, {type: 'number', unit: 'руб'});
                    }
                    let gsm_state = dev['io']['gsm-state'];
                    if (gsm_state != undefined) {
                        updateState(obj_name + '.gsm_level', 'GSM Уровень сигнала', gsm_state.level, {type: 'number'});
                        updateState(obj_name + '.gsm_operator', 'GSM Оператор', gsm_state.operator, {type: 'string'});
                    }
                }
                
                // авто
                processAutoDev(obj_name, dev);

                // произвольные действия
                processCustomControls(obj_name, dev);
            }
        });
    });
}

function processCustomControls(dev_obj_name, data) {
    let capa = data['capabilities'];
    if (hasElement(capa, "has_custom_controls_schedule")) {
        if (hasElement(capa, 'custom_controls')) {
            for (let i = 0; i < data['custom_controls'].length; i++) {
                let control = data['custom_controls'][i];
            }
        }
    }
}

function getBatteryState(volt) {
    if (volt != null) {
        let realBattery = volt*(BATTERY_DEFAULT_VOLTAGE/100)*1000;
        if (realBattery > 100) {
            realBattery = 100;
        }
        return realBattery;
    }
    return 0;
}

function processTermDev(dev_obj_name, data) {
    let capa = data['capabilities'];
    // термометры
    if (hasElement(capa, "has_thermometer_functions")) {
        if (hasElement(capa, 'has_multiple_thermometers') && data['thermometers']) {
            for (let j = 0; j < data['thermometers'].length; j++) {
                let term = data['thermometers'][j],
                    term_id = term['uuid'],
                    term_name = term['name'],
                    enabled = term['is_assigned_to_slot'],
                    state_name = dev_obj_name + '.' + 'therm_' + term_id,
                    state_val = term['last_value'];
                if (enabled) {
                    updateState(state_name, term_name, state_val, {type: 'number', unit: '°'});
                }
            }
        }
    }
    // zont-H2000+ (z3k) and possible H-1000/2000
    if (hasElement(capa, 'has_z3k_settings')) {
        // radio
        let radioSensors = {};
        if (hasElement(capa, 'has_rf')) {
            for (var sensor in data['z3k_config']['radiosensors']) {
                radioSensors[data['z3k_config']['radiosensors'][sensor]['id']] = data['z3k_config']['radiosensors'][sensor]['name']
            }
        }
        let wiredSensors = {};
        if (data['z3k_config']['radiosensors']){
            for (var sensor in data['z3k_config']['wired_temperature_sensors']) {
                wiredSensors[data['z3k_config']['wired_temperature_sensors'][sensor]['id']] = data['z3k_config']['wired_temperature_sensors'][sensor]['name']
            }
        }

        if (hasElement(capa, 'has_thermostat')){
            for (let element in data['z3k_config']['heating_circuits']) {
                heatingCircuits[data['z3k_config']['heating_circuits'][element]['id']] = data['z3k_config']['heating_circuits'][element]['name']
            }
            for (let element in data['z3k_config']['heating_modes']) {
                heatingModes[data['z3k_config']['heating_modes'][element]['id']] = {
                    'name': data['z3k_config']['heating_modes'][element]['name']
                }
                for (let zone in data['z3k_config']['heating_modes'][element]['heating_zones']) {
                    if (data['z3k_config']['heating_modes'][element]['heating_zones'][zone]['heating_circuit'] != undefined) {
                        if (Object.keys(heatingCircuits).includes(data['z3k_config']['heating_modes'][element]['heating_zones'][zone]['heating_circuit'].toString()) ){
                            if (data['z3k_config']['heating_modes'][element]['heating_zones'][zone]['adjusting_sensor'] != null) {
                                heatingModes[data['z3k_config']['heating_modes'][element]['id']]["circuit_on"] = data['z3k_config']['heating_modes'][element]['heating_zones'][zone]['heating_circuit'];
                            }
                            if (data['z3k_config']['heating_modes'][element]['heating_zones'][zone]['adjusting_sensor'] == null) {
                                heatingModes[data['z3k_config']['heating_modes'][element]['id']]["circuit_off"] = data['z3k_config']['heating_modes'][element]['heating_zones'][zone]['heating_circuit'];
                            }
                        }
                    }
                }
            }
        }

        for (let element in data['io']['z3k-state']) {
            let z3kStateObj = data['io']['z3k-state'][element];
            if (element in radioSensors){
                let term_id = element,
                    term_name = radioSensors[element],
                    enabled = z3kStateObj['sensor_ok'],
                    state_name = dev_obj_name + '.' + 'radio.therm_' + term_id,
                    state_val = z3kStateObj['temperature'],
                    battery = z3kStateObj['battery'],
                    humidity = z3kStateObj['humidity'],
                    rssi = z3kStateObj['rssi'];
                    adapter.log.info(JSON.stringify(z3kStateObj));
                    let real_battery = getBatteryState(battery)
                if (enabled) {
                    updateState(state_name, term_name, state_val, {type: 'number', unit: '°'});
                    updateState(state_name + '.battery', term_name, real_battery, {type: 'number', unit: '%'});
                    updateState(state_name + '.humidity', term_name, humidity, {type: 'number', unit: '%'});
                    updateState(state_name + '.rssi', term_name, rssi, {type: 'number', unit: 'dbi'});
                }
            }
            if (element in wiredSensors){
                let term_id = element,
                    term_name = wiredSensors[element],
                    enabled = z3kStateObj['sensor_ok'],
                    state_name = dev_obj_name + '.' + 'wired.therm_' + term_id,
                    state_val = z3kStateObj['curr_temp'];
                if (enabled) {
                    updateState(state_name, term_name, state_val, {type: 'number', unit: '°'});
                }
            }
            if (element in heatingCircuits) {
                let term_id = element,
                    term_name = heatingCircuits[element],
                    state_name = dev_obj_name + '.' + 'heatingCircuits.circuit_' + term_id,
                    status = z3kStateObj['status'],
                    target_temp = z3kStateObj['target_temp'];
                updateState(state_name, term_name, status, {type: 'number', unit: ''});
                if (target_temp == null){
                    target_temp = 0
                }
                updateState(state_name + '.target_temp', term_name, target_temp, {type: 'number', unit: '°'});
            }
        }
    }

    // термостат
    if (hasElement(capa, "has_thermostat")) {
        let term = data['io']['last-boiler-state'] || data,
            ot = data['io']['ot_state'],
            state_name = dev_obj_name + '.';
        // расширенный режим
        if (hasElement(capa, "has_extmodes") || data['thermostat_ext_modes_config']) {
            let modes = [], obj = data['thermostat_ext_modes_config'];
            for (let p in obj) {
                if(obj.hasOwnProperty(p)) {
                    let mode = obj[p];
                    if (mode.active) {
                        modes.push(p + ':' + mode.name);
                        for (let z in mode.zone_temp) {
                            if(mode.zone_temp.hasOwnProperty(z) && mode.zone_temp[z]) {
                                updateState(state_name + 'thermostat_temp__'+p+'__'+z, 'Температура режима ('+mode.name+') зоны ('+z+') термостата', mode.zone_temp[z], {type: 'number', unit: '°', write: true});
                            }
                        }
                    }
                }
            }
            let modess = modes.join(';');
            updateState(state_name + 'thermostat_ext_mode', 'Режим термостата', data['thermostat_ext_mode'], {type: 'number', states: modess, write: true});
        } else {
            let modess = 'comfort:Комфорт;econom:Эконом;idle:Антизаморозка;schedule:Расписание';
            updateState(state_name + 'thermostat_mode', 'Режим термостата', data['thermostat_mode'], {type: 'string', states: modess, write: true});
            let obj = data['thermostat_mode_temps'];
            for (let p in obj) {
                if(obj.hasOwnProperty(p) && obj[p]) {
                    updateState(state_name + 'thermostat_temp__'+p, 'Температура режима ('+p+') термостата', obj[p], {type: 'number', unit: '°', write: true});
                }
            }
        }
        if (!term) return;
        if (term['target_temp'] != undefined) {
            updateState(state_name+'target_temp', 'Целевая температура', term['target_temp'], {type: 'number', unit: '°', write: false});
        }
        // новый способ регулировки целевой температуры
        if (term['zones'] != undefined) {
            let obj = term['zones'];
            for (let p in obj) {
                if(obj.hasOwnProperty(p)) {
                    let mode = obj[p];
                    updateState(state_name + 'target_temp__'+p, 'Целевая температура зоны ('+p+')', mode.target_temp, {type: 'number', unit: '°', write: true});
                }
            }
        }

        if (term['boiler_work_time'] != undefined) {
            updateState(state_name+'boiler_work_time', 'Время работы котла', term['boiler_work_time'], {type: 'number', unit: 'сек'});
        }
        if (term['pza_t'] != undefined) {
            updateState(state_name+'pza_t', 'ПЗА Расчётная температура', term['pza_t'], {type: 'number', unit: '°'});
        }
        if (data['pza'] != undefined) {
            updateState(state_name+'pza', 'ПЗА активен', data['pza'].enabled, {type: 'boolean'});
        }
        if (term['dhw_t'] != undefined) {
            updateState(state_name+'dhw_t', 'Заданная температура ГВС', term['dhw_t'], {type: 'number', unit: '°'});
        }
        if (term['power'] != undefined) {
            updateState(state_name+'power', 'Наличие питания', term['power'], {type: 'string'});
        }
        if (term['fail'] != undefined) {
            updateState(state_name+'fail', 'Авария котла', term['fail'], {type: 'string'});
        }
        // OT
        if (data['ot_enabled'] != undefined) {
            updateState(state_name + 'ot_enabled', 'OpenTherm активен', data['ot_enabled'], {type: 'boolean'});
        }
        if (ot && ot['cs'] != undefined) {
            updateState(state_name+'ot_cs', 'OT Заданная температура воды', ot['cs'], {type: 'number', unit: '°'});
        }
        if (ot && ot['bt'] != undefined) {
            updateState(state_name+'ot_bt', 'OT Фактическая температура воды', ot['bt'], {type: 'number', unit: '°'});
        }
        if (ot && ot['dt'] != undefined) {
            updateState(state_name+'ot_dt', 'OT Фактическая температура ГВС', ot['dt'], {type: 'number', unit: '°'});
        }
        if (ot && ot['rml'] != undefined) {
            updateState(state_name+'ot_rml', 'OT Уровень модуляции горелки', ot['rml'], {type: 'number', unit: '%'});
        }
        if (ot && ot['rwt'] != undefined) {
            updateState(state_name+'ot_rwt', 'OT Температура обратного потока', ot['rwt'], {type: 'number', unit: '°'});
        }
        if (ot && ot['ot'] != undefined) {
            updateState(state_name+'ot_ot', 'OT Уличная температура', ot['ot'], {type: 'number', unit: '°'});
        }
        if (ot && ot['wp'] != undefined) {
            updateState(state_name+'ot_wp', 'OT Давление носителя', ot['wp'], {type: 'number', unit: 'бар'});
        }
        if (ot && ot['fr'] != undefined) {
            updateState(state_name+'ot_fr', 'OT Скорость потока ГВС', ot['fr'], {type: 'number'});
        }
        if (ot && ot['s'] && ot['s'].length > 0) {
            /*"f" – авария
            "ch" – отопление включено
            "dhw" – ГВС включено
            "fl" – горелка работает
            "cl" – охлаждение работает
            "ch2" – второй контур отопления включен
            "di" – диагностическая индикация*/
            updateState(state_name+'ot_s', 'OT Горелка активна', hasElement(ot['s'], 'fl'), {type: 'boolean'});
        }
        if (ot && ot['ff'] != undefined) {
            updateState(state_name+'ot_ff', 'OT Код ошибки', ot['ff'].c, {type: 'number'});
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
            updateState(state_name+'door_1', 'Дверь 1 открыта', io['door-1'], {type: 'boolean'});
        }
        if (io['door-2'] != undefined) {
            updateState(state_name+'door_2', 'Дверь 2 открыта', io['door-2'], {type: 'boolean'});
        }
        if (io['door-3'] != undefined) {
            updateState(state_name+'door_3', 'Дверь 3 открыта', io['door-3'], {type: 'boolean'});
        }
        if (io['door-4'] != undefined) {
            updateState(state_name+'door_4', 'Дверь 4 открыта', io['door-4'], {type: 'boolean'});
        }
        if (io['doors'] != undefined) {
            updateState(state_name+'doors', 'Двери открыты', io['doors'], {type: 'boolean'});
        }
        if (io['trunk'] != undefined) {
            updateState(state_name+'trunk', 'Багажник открыт', io['trunk'], {type: 'boolean'});
        }
        if (io['hood'] != undefined) {
            updateState(state_name+'hood', 'Капот открыт', io['hood'], {type: 'boolean'});
        }
        if (io['hood-trunk'] != undefined) {
            updateState(state_name+'hood_trunk', 'Капот или багажник открыт', io['hood-trunk'], {type: 'boolean'});
        }
    }
    if (hasElement(capa, "has_engine_block") && io['engine-block'] != undefined) {
        updateState(state_name+'engine_block', 'Блокировка двигателя', io['engine-block'], {type: 'boolean', write: true});
    }
    if (hasElement(capa, "has_webasto") && io['webasto'] != undefined) {
        updateState(state_name+'webasto', 'Предпусковой подогреватель (webasto)', io['webasto'], {type: 'boolean', write: true});
    }
    if (hasElement(capa, "has_ztcconfig_autostart")) {
        if (io['auto-ignition'] != undefined) {
            var modesa = 'disabled:Отключен;enabled:Запуск;engine:Запуск двигателя;webasto:Предпусковой';
            updateState(state_name+'auto_ignition', 'Автозапуск', undefined, {type: 'string', states: modesa, write: true});
            var modess = 'disabled:Отключен;enabling:Запуск двигателя;enabled:Запущен;webasto:Предпусковой;webasto-confirmed:Подтверждено';
            updateState(state_name+'auto_ignition_state', 'Состояние автозапуска', io['auto-ignition']['state'], {type: 'string', states: modess});
            //updateState(state_name+'auto_engine', 'Автозапуск двигателя', io['auto-ignition']['current_mode']['engine'], {type: 'boolean'});
            //updateState(state_name+'auto_webasto', 'Предпусковой подогреватель (webasto)', io['auto-ignition']['current_mode']['webasto'], {type: 'boolean'});
            updateState(state_name+'auto_until', 'Время отключения автозапуска', io['auto-ignition']['until'], {type: 'number'});
        }
    } else if (hasElement(capa, "has_autostart")) {
        if (io['auto-ignition'] != undefined) {
            updateState(state_name+'auto_ignition', 'Автозапуск', io['auto-ignition']['state'], {type: 'boolean', write: true});
        }
    }
    if (io['ignition-state'] != undefined) {
        updateState(state_name+'ignition_state', 'Двигатель запущен', io['ignition-state'], {type: 'boolean'});
    }
    if (hasElement(capa, "has_voltage_sensor") && io['voltage'] != undefined) {
        updateState(state_name+'voltage', 'Напряжение питания', io['voltage'], {type: 'number', unit: 'V'});
    }
    // температурные сенсоры
    if (hasElement(capa, "has_temperature_sensors") && io['temperature'] && io['temperature'].length > 0) {
        for (let i = 0; i < data['temperature_conf']['assignments'].length; i++){
            if (io['temperature'][i] === null) continue;
            let ttype = data['temperature_conf']['assignments'][i],
                val = io['temperature'][i].value;
            switch(ttype) {
                case 'engine':
                    updateState(state_name+'temp_engine', 'Температура двигателя', val, {type: 'number', unit: '°'});
                    break;
                case 'cabin':
                    updateState(state_name+'temp_cabin', 'Температура салона', val, {type: 'number', unit: '°'});
                    break;
                case 'outside':
                    updateState(state_name+'temp_outside', 'Температура снаружи', val, {type: 'number', unit: '°'});
                    break;
            }
        }
    }
    if (hasElement(capa, "has_gps") && data['last_gps'] && data['last_gps'].length > 0) {
        let last_gps = data['last_gps'][0];
        updateState(state_name+'gps_x', 'GPS X', last_gps.x, {type: 'number'});
        updateState(state_name+'gps_y', 'GPS Y', last_gps.y, {type: 'number'});
        updateState(state_name+'gps_speed', 'GPS Скорость', last_gps.speed, {type: 'number'});
        updateState(state_name+'gps_time', 'GPS Время последих показаний', last_gps.time, {type: 'number'});
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
}

/*
 * Copyright 2018. F5 Networks, Inc. See End User License Agreement ("EULA") for
 * license terms. Notwithstanding anything to the contrary in the EULA, Licensee
 * may copy and modify this software product for its internal business purposes.
 * Further, Licensee may upload, publish and distribute the modified version of
 * the software product on devcentral.f5.com.
 */

'use strict';

const mustache = require('mustache');

const constants = require('./constants.js');
const util = require('./util.js');
const normalize = require('./normalize.js');
const properties = require('./config/properties.json');
const paths = require('./config/paths.json');
const logger = require('./logger.js');
const EndpointLoader = require('./endpointLoader');

const stats = properties.stats;
const context = properties.context;
const definitions = properties.definitions;
const global = properties.global;

const CONDITIONAL_FUNCS = {
    deviceVersionGreaterOrEqual,
    isModuleProvisioned
};


/**
 * System Stats Class
 */
function SystemStats() {
    this.loader = null;
    this.contextData = {};
    this.collectedData = {};
    this.tags = {};
}
/**
 * Split key
 *
 * @param {String} key - key to split
 *
 * @returns {Object} Return data formatted like { rootKey: 'key, childKey: 'key' }
 */
SystemStats.prototype._splitKey = function (key) {
    const splitKeys = key.split(constants.STATS_KEY_SEP);
    const rootKey = splitKeys[0];
    // remove root key from splitKeys
    splitKeys.shift();
    const childKey = splitKeys.length > 0 ? splitKeys.join(constants.STATS_KEY_SEP) : undefined;
    return { rootKey, childKey };
};
/**
 * Evaluate conditional block
 *
 * @param {Object} conditionalBlock - block to evaluate, where object's key - conditional opertor
 *                                    object's value - params for that operator
 *
 * @returns {boolean} conditional result
 */
SystemStats.prototype._resolveConditional = function (conditionalBlock) {
    let ret = true;
    Object.keys(conditionalBlock).forEach((key) => {
        const func = CONDITIONAL_FUNCS[key];
        if (func === undefined) {
            throw new Error(`Unknown property in conditional block ${key}`);
        }
        ret = ret && func(this.contextData, conditionalBlock[key]);
    });
    return ret;
};
/**
 * Property pre-processing to resolve conditionals
 *
 * @param {Object} property - property object
 *
 * @returns {Object} pre-processed deep copy of property object
 */
SystemStats.prototype._preprocessProperty = function (property) {
    if (property.if) {
        const newObj = {};
        // property can result in 'false' when
        // 'else' or 'then' were not defined.
        while (property) {
            // copy all non-conditional data on same level to new object
            // eslint-disable-next-line no-loop-func
            Object.keys(property).forEach((key) => {
                if (!(key === 'if' || key === 'then' || key === 'else')) {
                    newObj[key] = property[key];
                }
            });
            // so, we copied everything we needed.
            // break in case there is no nested 'if' block
            if (!property.if) {
                break;
            }
            // trying to resolve conditional
            property = this._resolveConditional(property.if)
                ? property.then : property.else;
        }
        property = newObj;
    }
    // deep copy
    return util.deepCopy(property);
};
/**
 * Render key using mustache template system
 *
 * @param {Object} property - property object
 *
 * @returns {Object} rendered property object
 */
SystemStats.prototype._renderProperty = function (property) {
    // should be easy to add support for more complex templates like {{ #something }}
    // but not sure we are really need it now.
    // For now just supporting simple templates which
    // generates single string only
    if (property.key) property.key = mustache.render(property.key, this.contextData);
    return property;
};
/**
 * Process loaded data
 *
 * @param {Object} property - property object
 * @param {Object} data     - data object
 * @param {string} key      - property key associated with data
 *
 * @returns {Object} normalized data (if needed)
 */
SystemStats.prototype._processData = function (property, data, key) {
    const defaultTags = { name: { pattern: '(.*)', group: 1 } };
    const addKeysByTagIsObject = property.addKeysByTag && typeof property.addKeysByTag === 'object';

    // standard options for normalize, these are driven primarily by the properties file
    const options = {
        key: this._splitKey(property.key).childKey,
        filterByKeys: property.filterKeys ? [property.filterKeys, global.filterKeys] : [global.filterKeys],
        renameKeysByPattern: property.renameKeys ? [property.renameKeys, global.renameKeys] : [global.renameKeys],
        convertArrayToMap: property.convertArrayToMap,
        includeFirstEntry: property.includeFirstEntry,
        formatTimestamps: global.formatTimestamps.keys,
        runCustomFunctions: property.runFunctions,
        addKeysByTag: { // add 'name' + any user configured tags if specified by prop
            tags: property.addKeysByTag ? Object.assign(defaultTags, this.tags) : defaultTags,
            definitions,
            opts: addKeysByTagIsObject ? property.addKeysByTag : global.addKeysByTag
        },
        propertyKey: key
    };
    return property.normalize === false ? data : normalize.data(data, options);
};
/**
 * Load data for property
 *
 * @param {Object} property       - property object
 * @param {String} [property.key] - key to identify endpoint to load data from
 * @returns {Object} Promise resolved with fetched data object
 */
SystemStats.prototype._loadData = function (property) {
    return new Promise((resolve, reject) => {
        const endpoint = this._splitKey(property.key).rootKey;
        this.loader.loadEndpoint(endpoint, property.keyArgs, (data, err) => {
            if (err) {
                reject(err);
                return;
            }
            if (!data.data.items) {
                data.data.items = [];
            }
            resolve(data.data);
        });
    });
};
/**
 * Process property
 *
 * @param {String} key      - key to store collected data
 * @param {Object} property - property object
 *
 * @returns {Object} Promise resolved when data was successfully colleted
 */
SystemStats.prototype._processProperty = function (key, property) {
    property = this._renderProperty(this._preprocessProperty(property));
    /**
     * if endpoints will have their own 'disabled' flag
     * we will need to add additional check here or simply return empty value.
     * An Empty value will result in 'missing key' after normalization.
     */
    if (property.disabled) {
        return Promise.resolve();
    }

    // support property simply being a folder - add as empty object
    if (property.structure && property.structure.folder === true) {
        this.collectedData[key] = {};
        return Promise.resolve();
    }

    return this._loadData(property)
        .then((data) => {
            this.collectedData[key] = this._processData(property, data, key);
        })
        .catch((err) => {
            logger.error(`Error: SystemStats._processProperty: ${key} (${property.key}): ${err}`);
            return Promise.reject(err);
        });
};
/**
 * Process context object
 *
 * @param {Object} contextData         - context object to load
 * @param {String} [contextData.key]   - key to store loaded data
 * @param {Object} [contextData.value] - property object to use to load data
 *
 * @returns {Object} Promise resolved when all context's properties were loaded
 */
SystemStats.prototype._processContext = function (contextData) {
    const promises = Object.keys(contextData)
        .map(key => this._processProperty(key, contextData[key]));

    return Promise.all(promises).then(() => {
        Object.assign(this.contextData, this.collectedData);
        this.collectedData = {};
    });
};
/**
 * Compute all contextual data
 *
 * @param {Object | Array} contextData - context object(s) to load
 *
 * @returns (Object) Promise resolved when contextual data were loaded
 */
SystemStats.prototype._computeContextData = function (contextData) {
    let promise;

    if (Array.isArray(contextData)) {
        if (contextData.length) {
            promise = this._processContext(contextData[0]);
            for (let i = 1; i < contextData.length; i += 1) {
                promise.then(this._processContext(contextData[i]));
            }
        }
    } else if (contextData) {
        promise = this._processContext(contextData);
    }
    if (!promise) {
        promise = Promise.resolve();
    }
    return promise;
};
/**
 * Compute properties
 *
 * @param {Object} propertiesData - object with properties
 *
 * @returns {Object} Promise resolved when all properties were loaded
 */
SystemStats.prototype._computePropertiesData = function (propertiesData) {
    return Promise.all(Object.keys(propertiesData)
        .map(key => this._processProperty(key, propertiesData[key])));
};
/**
 * Collect info based on object provided in properties
 *
 * @param {String}  host                                     - host
 * @param {Object}  [options]                                - options
 * @param {Object}  [options.tags]                           - tags to add to the data (each key)
 * @param {String}  [options.credentials.username]           - username for host
 * @param {String}  [options.credentials.passphrase]         - password for host
 * @param {String}  [options.connection.protocol]            - protocol for host
 * @param {Integer} [options.connection.port]                - port for host
 * @param {Boolean} [options.connection.allowSelfSignedCert] - false - requires SSL certificates be valid,
 *                                                             true - allows self-signed certs
 *
 * @returns {Object} Promise which is resolved with a map of stats
 */
SystemStats.prototype.collect = function (host, options) {
    if (options.tags) this.tags = options.tags;

    this.loader = new EndpointLoader(host, options);
    this.loader.setEndpoints(paths.endpoints);

    return this.loader.auth()
        .then(() => this._computeContextData(context))
        .then(() => this._computePropertiesData(stats))
        .then(() => {
            // order data according to properties file
            const data = {};
            Object.keys(stats).forEach((key) => {
                data[key] = this.collectedData[key];
            });
            // certain stats require a more complex structure - process those
            Object.keys(data).forEach((key) => {
                const stat = stats[key] || {};
                if (stat.structure && !stat.structure.folder) {
                    const parentKey = stat.structure.parentKey;
                    data[parentKey][key] = data[key];
                    delete data[key];
                }
            });
            return Promise.resolve(data);
        })
        .catch((err) => {
            logger.error(`Error: SystemStats.collect: ${err}`);
            return Promise.reject(err);
        });
};

/**
 * Comparison functions
 */

/**
 * Compare device versions
 *
 * @param {Object} contextData               - context data
 * @param {Object} contextData.deviceVersion - device's version to compare
 * @param {String} versionToCompare          - version to compare against
 *
 * @returns {boolean} true when device's version is greater or equal
 */
function deviceVersionGreaterOrEqual(contextData, versionToCompare) {
    const deviceVersion = contextData.deviceVersion;
    if (deviceVersion === undefined) {
        throw new Error('deviceVersionGreaterOrEqual: context has no property \'deviceVersion\'');
    }
    return util.compareVersionStrings(deviceVersion, '>=', versionToCompare);
}

/**
 * Compare provisioned modules
 *
 * @param {Object} contextData               - context data
 * @param {Object} contextData.provisioning  - provision state of modules to compare
 * @param {String} moduletoCompare           - module to compare against
 *
 * @returns {boolean} true when device's module is provisioned
 */
function isModuleProvisioned(contextData, moduleToCompare) {
    const provisioning = contextData.provisioning;
    if (provisioning === undefined) {
        throw new Error('isModuleProvisioned: context has no property \'provisioning\'');
    }
    return ((provisioning[moduleToCompare] || {}).level || 'none') !== 'none';
}

module.exports = SystemStats;

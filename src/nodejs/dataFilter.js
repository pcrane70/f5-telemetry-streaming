/*
 * Copyright 2019. F5 Networks, Inc. See End User License Agreement ("EULA") for
 * license terms. Notwithstanding anything to the contrary in the EULA, Licensee
 * may copy and modify this software product for its internal business purposes.
 * Further, Licensee may upload, publish and distribute the modified version of
 * the software product on devcentral.f5.com.
 */

'use strict';

const util = require('./util.js');
const dataUtil = require('./dataUtil.js');

/**
 * Data Filter Class
 *
 * @param {Object} config - consumer config object
 */
function DataFilter(consumerConfig) {
    this._consumerConfig = util.deepCopy(consumerConfig);
    this.blacklist = {};

    this._applyGlobalFilters();
}

/**
 * Filter data
 *
 * @param {Object} dataCtx      - data context
 * @param {Object} dataCtx.data - actual data to filter
 * @param {string} dataCtx.type - type of data to filter
 *
 * @returns {Object} Deep copy data context with filtered data
 */
DataFilter.prototype.apply = function (dataCtx) {
    const dataCtxCopy = util.deepCopy(dataCtx);

    this._applyBlacklist(dataCtxCopy.data);

    return dataCtxCopy;
};

/**
 * Add default global filters based on consumer config
 *
 * @returns {void}
 */
DataFilter.prototype._applyGlobalFilters = function () {
    // tmstats is only supported by Splunk legacy until users can specify desired tables
    if (this._consumerConfig.type !== 'Splunk' || this._consumerConfig.config.format !== 'legacy') {
        this.blacklist = Object.assign(this.blacklist, { tmstats: true });
    }
};

/**
 * Removes properties from data object based on blacklist
 *
 * @returns {void}
 */
DataFilter.prototype._applyBlacklist = function (data) {
    const matches = dataUtil.getDeepMatches(data, this.blacklist);
    // Delete matching property. Can be performed on array but must avoid reindexing until all
    // matches are removed
    matches.forEach((match) => {
        delete match.data[match.key];
    });
    // Reindex any arrays that were modified
    matches.forEach((match) => {
        if (Array.isArray(match.data)) {
            for (let i = match.data.length - 1; i >= 0; i -= 1) {
                if (typeof match.data[i] === 'undefined') {
                    match.data.splice(i, 1);
                }
            }
        }
    });
};

module.exports = DataFilter;

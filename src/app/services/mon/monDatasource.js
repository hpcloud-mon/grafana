define([
  'angular',
  'lodash',
  'kbn',
  'moment',
],
function (angular, _, kbn) {
  'use strict';

  var module = angular.module('grafana.services');
  module.config(['$httpProvider', function ($httpProvider) {
    $httpProvider.defaults.useXDomain = true;
  }]);

  module.factory('MonDatasource', function ($q, $http) {
    function MonDatasource(datasource) {
      this.type = 'mon';
      this.editorSrc = 'app/partials/mon/editor.html';
      this.urls = datasource.urls;
      this.name = datasource.name;
      var query = window.location.href.split('?')[1];
      var vars = query.split("&");
      for (var i=0;i<vars.length;i++) {
        var pair = vars[i].split("=");
        if (pair[0] === "api") {
          this.api = decodeURIComponent(pair[1]);
        }
      }
    }

    MonDatasource.prototype.query = function (options) {

      var _this = this;
      var startTime = getMonTime(options.range.from);
      return $q.all(this.getTargets(options.targets, startTime)).then(function (args) {
        var newTargets = _.flatten(args);
        var promises = _.map(newTargets, function (target) {

          if (target.hide || !((target.series && target.column) || target.query)) {
            return [];
          }

          if (target.rawQuery) {
            alert("Raw queries not supported");
            return [];
          }
          else {
            var params = {
              start_time: startTime
            };
            if (target.function !== 'none') {
              params.statistics = target.function;
            }
            if (target.series !== '') {
              params.name = target.series;
            }
            if (target.period !== '') {
              params.period = target.period;
            }
            if (target.condition_key && target.condition_value) {
              var key = target.condition_key;
              var value = target.condition_value;
              params.dimensions = key + ':' + value;
            }
            if (target.dimensions !== ''){
              params.dimensions = target.dimensions;
            }
            params.merge_metrics = target.merge;
            return _this.doGetStatisticsRequest(params, target.alias, target.label, startTime).then(handleGetStatisticsResponse);
          }
          return [];
        }, this);

        return $q.all(promises).then(function (results) {
          return {data: _.flatten(results)};
        });
      });
    };

    MonDatasource.prototype.listColumns = function (seriesName, startTime) {
      return this.doGetMetricsRequest(startTime, seriesName).then(function (data) {
        if (!data) {
          return [];
        }
        if (!(data instanceof Array)) {
         data = data['elements']
        }

        var columns = [];
        for (var i = 0; i < data.length; i++) {
          var dimensions = data[i].dimensions;
          for (var dimension in dimensions) {
            if (columns.indexOf(dimension) === -1) {
              columns.push(dimension);
            }
          }
        }
        return columns;
      });
    };

    MonDatasource.prototype.listValues = function (seriesName, startTime) {
      return this.doGetMetricsRequest(startTime, seriesName).then(function (data) {
        if (!data) {
          return [];
        }
        if (!(data instanceof Array)) {
          data = data['elements']
        }

        var values = [];
        for (var i = 0; i < data.length; i++) {
          var dimensions = data[i].dimensions;
          for (var dimension in dimensions) {
            if (values.indexOf(dimensions[dimension]) === -1) {
              values.push(dimensions[dimension]);
            }
          }
        }
        return values;
      });
    };

    MonDatasource.prototype.listSeries = function (startTime) {
      return this.doGetMetricsRequest(startTime).then(function (data) {
        if (!data) {
          return [];
        }
        if (!(data instanceof Array)) {
          data = data['elements']
        }
        var names = [];
        for (var i = 0; i < data.length; i++) {
          var name = data[i].name;
          if (names.indexOf(name) === -1) {
            names.push(name);
          }
        }
        return names;
      });
    };

    MonDatasource.prototype.getExpandedTargets = function (target, seriesDimensions, startTime) {
      return this.doGetMetricsRequest(startTime, target.series, seriesDimensions).then(function (data) {
        if (!data) {
          return [];
        }
        if (!(data instanceof Array)) {
          data = data['elements']
        }

        var results = [];
        for (var i = 0; i < data.length; i++) {
          var dimensions = data[i].dimensions;
          var tmp = "";
          for (var dimension in dimensions) {
            if (tmp != "") {
              tmp += ",";
            }
            tmp += (dimension + ":" + encodeURIComponent(dimensions[dimension]));
          }
          results.push(tmp);
        }
        var target_list = [];
        for (var i = 0; i < results.length; i++) {
          var temp = jQuery.extend({}, target);
          temp.dimensions = results[i];
          target_list.push(temp);
        }
        return target_list;
      });
    };


    MonDatasource.prototype.getTargets = function (originalTargets, startTime) {
      var targets = [];
      var returnTargets = originalTargets;
      for (var i = 0; i < returnTargets.length; i++) {
        var target = returnTargets[i];
        if (!target.merge) {
          var metricDimensions = "";
          if (target.condition_key && target.condition_value) {
            var key = target.condition_key;
            var value = target.condition_value;
            metricDimensions = key + ':' + value;
          }
          targets.push(this.getExpandedTargets(target, metricDimensions, startTime))
        }
        else {
          target.dimensions = "";
          targets.push(target);
        }
      }
      return targets;
    };

    function retry(deferred, callback, delay) {
      return callback().then(undefined, function (reason) {
        if (reason.status !== 0) {
          deferred.reject(reason);
        }
        setTimeout(function () {
          return retry(deferred, callback, Math.min(delay * 2, 30000));
        }, delay);
      });
    }

    /**
     * Gets the statics for the supplied params
     * @param params
     * @param alias
     * @returns {promise}
     */
    MonDatasource.prototype.doGetStatisticsRequest = function (params, alias, label, startTime) {
      var _this = this;
      var deferred = $q.defer();

      retry(deferred, function () {
        var currentUrl = _this.api;

        var headers = {
          'Content-Type': 'application/json'
        };

        var options = {
          method: 'GET',
          url: currentUrl + '/metrics/measurements/',
          params: params,
          withCredentials: true,
          headers: headers
        };

        if ('statistics' in params) {
          options.url = currentUrl + '/metrics/statistics';
        }

        return $http(options).success(function (data, status, headers, config) {
          if (headers('Content-Type').indexOf("text/html") != -1){
            window.location =  window.location.origin;
            return;
          }
          data.alias = alias;
          data.label = label;
          data.startTime = startTime;
          deferred.resolve(data);
        });
      }, 10);

      return deferred.promise;
    };

    /**
     * Gets the metric definitions for the supplied metric name.
     * @param metricName
     * @param metricDimensions
     * @param alias
     * @param startTime
     * @returns {promise}
     */
    MonDatasource.prototype.doGetMetricsRequest = function (startTime, metricName, metricDimensions, alias) {
      var _this = this;
      var deferred = $q.defer();
      var seriesName = metricName;

      retry(deferred, function () {
        var currentUrl = _this.api;

        var headers = {
          'Content-Type': 'application/json'
        };

        var params = {
          name: seriesName
        };

        if (metricDimensions !== ''){
          params.dimensions = metricDimensions;
        }

        if (startTime !== ''){
          params.start_time = startTime;
        }

        var options = {
          method: 'GET',
          url: currentUrl + '/metrics',
          params: params,
          withCredentials: true,
          headers: headers
        };

        return $http(options).success(function (data, status, headers, config) {
          if (headers('Content-Type').indexOf("text/html") != -1){
            window.location =  window.location.origin;
            return;
          }
          data.alias = alias;
          deferred.resolve(data);
        });
      }, 10);

      return deferred.promise;
    };

    function handleGetStatisticsResponse(data) {
      var output = [];

      var arg1 = data
      if (!(data instanceof Array)) {
        arg1 = data
        data = data['elements']
      }
      _.each(data, function (series) {
        var timeCol = series.columns.indexOf('timestamp');

        _.each(series.columns, function (column, index) {
          if (column === "timestamp" || column === "id" || column == "value_meta") {
            return;
          }

          var target;
          if (arg1.alias) {
            target = arg1.alias
          }
          else if (arg1.label) {
            target = series.dimensions[arg1.label];
          }
          else {
            target = series.name + "." + column + '(';
            for (var dimension in series.dimensions) {
              target += dimension + '=' + series.dimensions[dimension] + ',';
            }
            target += ')';
          }
          var datapoints = [];

          var from = moment.utc(new Date(arg1.startTime).getTime());

          if ('statistics' in series) {
            for (var i = 0; i < series.statistics.length; i++) {
              var myDate = new Date(series.statistics[i][timeCol]);
              var result = myDate.getTime();
              var last = moment.utc(result);
              if (last > from) {
                datapoints[i] = [series.statistics[i][index], result];
              }
            }
          } else {
            for (var j = 0; j < series.measurements.length; j++) {
              var myDate2 = new Date(series.measurements[j][timeCol]);
              var result2 = myDate2.getTime();
              datapoints[j] = [series.measurements[j][index], result2];
            }
          }

          output.push({ target: target, datapoints: datapoints });
        });
      });

      return output;
    }

    function getMonTime(date) {
      if (_.isString(date)) {
        if (date === 'now') {
          var d = new Date();
          return d.toISOString().slice(0, -5) + 'Z';
        }
        else if (date.indexOf('now') >= 0) {
          return kbn.parseDate(date).toISOString().slice(0,-5) + 'Z';
        }
        date = kbn.parseDate(date).toISOString().slice(0,-15) + 'Z';
      }
      return date.toISOString().slice(0,-5) + 'Z';
    }

    return MonDatasource;
  });

});

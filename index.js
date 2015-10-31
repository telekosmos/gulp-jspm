var gutil = require('gulp-util');
var jspm = require('jspm');
var Liftoff = require('liftoff');
var through = require('through2');
var Promise = require('bluebird');
Promise.longStackTraces();
var temp = require('temp').track();
var File = require('vinyl');
var fs = Promise.promisifyAll(require("fs"));
var path = require('path');

var projectName = require('./package.json').name;

module.exports = function (opts) {
	opts = opts || {};

	return through.obj(function (file, enc, cb) {
		var packageJson, configJsLoc;
		var bundleFilename = (function () {
			var basename = path.basename(file.path);
			basename = basename.split('.');
			basename.splice(1, 0, 'bundle');
			basename = basename.join('.');
			return path.join(path.dirname(file.path), basename);
		})();

		if (file.isNull()) {
			cb();
			return;
		}
		if (file.isStream()) {
			this.emit('error', new gutil.PluginError(projectName, 'Streams are not supported.'));
			cb();
			return;
		}

		var enable_source_map = !!file.sourceMap;
		var injectOpt = !!opts.inject;

		var push = this.push.bind(this);

		Promise.resolve()
			.then(function () {
				return set_jspm_package_path(file.base);
			})
			.then(function (jspmRoot) {
				// Maybe optimistically?: packageJson.jspm.configFile property
				configJsLoc = jspmRoot + '/config.js';

				var tempBundleFile = (function (pathname) {
					var auxName = pathname.split('/');
					auxName[auxName.length - 1] = '.' + auxName[auxName.length - 1];
					return auxName.join('/');
				})(bundleFilename);

				var promiseTempfile = fs.openAsync(tempBundleFile, 'w+').then(function () {
					return {
						path: tempBundleFile
					};
				});
				return [promiseTempfile, Promise.resolve(jspmRoot)];
			})
			.spread(function (tmp_file, jspmRoot) {
				return (
					jspm[opts.selfExecutingBundle ? 'bundleSFX' : 'bundle'](
						(function () {
							var jspm_input = path.relative(jspmRoot, file.path);
							if (opts.plugin) {
								jspm_input += '!';
								if (opts.plugin.constructor === String) {
									jspm_input += opts.plugin;
								}
							}
							if (opts.arithmetic) {
								jspm_input += ' ' + opts.arithmetic.trim();
							}

							return jspm_input;
						})(),
						tmp_file.path,
						(function () {
							var jspm_opts = {};
							for (var i in opts) jspm_opts[i] = opts[i];
							jspm_opts.sourceMaps = jspm_opts.sourceMaps || enable_source_map;
							delete jspm_opts.plugin;
							delete jspm_opts.arithmetic;
							delete jspm_opts.selfExecutingBundle;
							return jspm_opts;
						})()
					)
						.then(function () {
							return tmp_file.path;
						})
				);
			})
			.then(function (temp_path) {
				var results = {
					temp_path: temp_path
				};
				return Promise.all(
					[
						fs.readFileAsync(temp_path)
							.then(function (file_content) {
								if (enable_source_map) {
									var reSourceMapComment = /\n\/\/# sourceMappingURL=.+?$/;
									results.contents = new Buffer(file_content.toString().replace(reSourceMapComment, ''));
								}
								else {
									results.contents = file_content;
								}
							})
					].concat(
						!enable_source_map ? [] : (
							fs.readFileAsync(temp_path + '.map')
								.then(function (file_content) {
									results.sourceMap = JSON.parse(file_content.toString());
								})
						)
					)
				)
					.then(function () {
						return results;
					});
			})/*
		 .then(function(results){
		 temp.cleanup();
		 return results;
		 })*/
			.then(function (results) {
				var bundle_file =
					new File({
						base: file.base,
						path: (function () {
							var basename = path.basename(file.path);
							basename = basename.split('.');
							basename.splice(1, 0, 'bundle');
							basename = basename.join('.');
							return path.join(path.dirname(file.path), basename);
						})(),
						contents: results.contents
					});

				bundle_file.originalEntryPoint = file;

				if (enable_source_map) {
					bundle_file.sourceMap = results.sourceMap;
					bundle_file.sourceMap.file = bundle_file.relative;
					bundle_file.sourceMap.sources =
						bundle_file.sourceMap.sources.map(function (relative_to_temp) {
							return (
								path.relative(
									file.base,
									path.resolve(
										path.dirname(results.temp_path),
										relative_to_temp))
							);
						});
				}

				// deleting hidden temp files
				return fs.unlinkAsync(results.temp_path)
					.then(function () {
						if (enable_source_map)
							return fs.unlinkAsync(results.temp_path + '.map');
						else
							return Promise.resolve();
					})
					.then(function () {
						// Modify config.js bundles if inject option
						if (!injectOpt) {
							return bundle_file;
						}
						else {
							console.log('Updating config.js...');
							return fs.readFileAsync(configJsLoc)
								.then(function (data) {
									var filename = bundleFilename.split('/').pop();
									var replacement = data.toString().replace('".' + filename + '"', '"' + filename + '"');
									return replacement;
								})
								.then(function (data) {
									return fs.writeFileAsync(configJsLoc, data);
								})
								.then(function () {
									return bundle_file;
								})
								.catch(function (err) {
									console.log('ERR: ' + JSON.stringify(err));
								});

						} // EO else
					});
			})
			.then(function (bundle_file) {
				// timeout to stop Promise to catch errors
				setTimeout(function () {
					push(bundle_file);
					cb();
				}, 0);
			});
	});
};

function set_jspm_package_path(directory) {
	return new Promise(function (resolve) {
		new Liftoff({
			name: 'jspm',
			configName: 'package',
			extensions: {
				'.json': null
			}
		})
			.launch({
				cwd: directory
			}, function (env) {
				if (env.configBase) {
					jspm.setPackagePath(env.configBase);
				}

				var packageJSON = require(env.configPath);
				var guard = !!packageJSON && typeof packageJSON.jspm.directories.baseURL !== 'undefined';
				if (guard) {
					resolve(path.join(env.configBase, packageJSON.jspm.directories.baseURL));
				}
				else {
					resolve(env.configBase);
				}
			});
	})
};

### v0.5.4@telekosmos

This is a modified version of the plugin strongly based on [gulp-jspm](http://github.com/brillout/gulp-jspm).

#### --inject
*[`460c526`](https://github.com/telekosmos/gulp-jspm/commit/460c526)
No longer use temp files ([temp](https://npmjs.org/package/temp)).
Support for `--inject` __jspm__ options via `{inject: true}`. Injection updates the `config.js` file, so using `gulp.dest(<path>)` to save the stream emit by this plugin may lead to file duplication and, if _jspm bundle_ is the last step of the build, should be avoided.
Typical use for this fix is:
```javascript
var gulpJspm = require('gulp-jspm');
gulp.src(<mainFile>)
  .pipe(gulpJspm({inject: true}));
```
will produce a `<mainFile>.bundle.js` in the current dir or the `jspm.directories.baseURL` dir, updating the __config.js__ file.

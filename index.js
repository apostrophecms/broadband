var _ = require('lodash');

module.exports = function(cursor, limit, each, callback) {
  var taskQueue = [];
  var error;
  var eof;
  var id = 0;
  var nextObjectQueue = [];
  var nextObjectActive = false;

  function fill() {
    // Because the end condition tests in our tasks are
    // not guaranteed to wait for nextTick, we must check for
    // the same end conditions here, otherwise broadband
    // may terminate twice.
    while ((taskQueue.length < limit) && (!(error || eof))) {
      var fn = makeTask(id++);
      taskQueue.push(fn);
      fn();
    }

    function makeTask(id) {
      var fn = function() {
        if (error || eof) {
          return setImmediate(_.partial(finished, id));
        }
        // cursor.nextObject must never be called concurrently,
        // so call our wrapper that serializes it
        return nextObject(function(err, doc) {
          error = error || err;
          if (error) {
            return finished(id);
          }
          if (!doc) {
            eof = true;
            return finished(id);
          }
          return each(doc, function(err) {
            error = error || err;
            return finished(id);
          });
        });
      };
      fn.id = id;
      return fn;
    }

    function finished(id) {
      _.remove(taskQueue, function(fn) {
        return fn.id === id;
      });
      if ((error || eof) && (!taskQueue.length)) {
        // End of a long road
        return callback(error);
      }
      if (!(error || eof)) {
        fill();
      }
    }
  }

  fill();

  // Serialize calls to nextObject
  function nextObject(callback) {
    if (callback) {
      nextObjectQueue.push(callback);
    }
    if (!nextObjectQueue.length) {
      return;
    }
    if (!nextObjectActive) {
      nextObjectActive = true;
      var fn = nextObjectQueue.shift();
      if (error || eof) {
        return setImmediate(function() {
          fn(error, null);
          nextObjectActive = false;
          nextObject();
        });
      }
      return cursor.nextObject(function(err, doc) {
        fn(err, doc);
        nextObjectActive = false;
        nextObject();
      });
    }
  }
};

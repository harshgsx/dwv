// namespaces
var dwv = dwv || {};
dwv.tool = dwv.tool || {};

/**
 * Livewire painting tool.
 *
 * @class
 * @param {dwv.App} app The associated application.
 */
dwv.tool.Livewire = function (app) {
  /**
   * Closure to self: to be used by event handlers.
   *
   * @private
   * @type {dwv.tool.Livewire}
   */
  var self = this;
  /**
   * Interaction start flag.
   *
   * @type {boolean}
   */
  this.started = false;

  /**
   * Draw command.
   *
   * @private
   * @type {object}
   */
  var command = null;
  /**
   * Current shape group.
   *
   * @private
   * @type {object}
   */
  var shapeGroup = null;
  /**
   * Drawing style.
   *
   * @type {dwv.gui.Style}
   */
  this.style = new dwv.gui.Style();

  /**
   * Path storage. Paths are stored in reverse order.
   *
   * @private
   * @type {dwv.math.Path}
   */
  var path = new dwv.math.Path();
  /**
   * Current path storage. Paths are stored in reverse order.
   *
   * @private
   * @type {dwv.math.Path}
   */
  var currentPath = new dwv.math.Path();
  /**
   * List of parent points.
   *
   * @private
   * @type {Array}
   */
  var parentPoints = [];
  /**
   * Tolerance.
   *
   * @private
   * @type {number}
   */
  var tolerance = 5;

  /**
   * Listener handler.
   *
   * @type {object}
   * @private
   */
  var listenerHandler = new dwv.utils.ListenerHandler();

  /**
   * Clear the parent points list.
   *
   * @param {object} imageSize The image size.
   * @private
   */
  function clearParentPoints(imageSize) {
    var nrows = imageSize.get(1);
    for (var i = 0; i < nrows; ++i) {
      parentPoints[i] = [];
    }
  }

  /**
   * Clear the stored paths.
   *
   * @private
   */
  function clearPaths() {
    path = new dwv.math.Path();
    currentPath = new dwv.math.Path();
  }

  /**
   * Scissor representation.
   *
   * @private
   * @type {dwv.math.Scissors}
   */
  var scissors = new dwv.math.Scissors();

  /**
   * Handle mouse down event.
   *
   * @param {object} event The mouse down event.
   */
  this.mousedown = function (event) {
    var layerDetails = dwv.gui.getLayerDetailsFromEvent(event);
    var layerGroup = app.getLayerGroupById(layerDetails.groupId);
    var viewLayer = layerGroup.getActiveViewLayer();
    var imageSize = viewLayer.getViewController().getImageSize();
    var index = viewLayer.displayToPlaneIndex(event._x, event._y);

    // first time
    if (!self.started) {
      self.started = true;
      self.x0 = index.get(0);
      self.y0 = index.get(1);
      // clear vars
      clearPaths();
      clearParentPoints(imageSize);
      shapeGroup = null;
      // update zoom scale
      var drawLayer = layerGroup.getActiveDrawLayer();
      self.style.setZoomScale(
        drawLayer.getKonvaLayer().getAbsoluteScale());
      // do the training from the first point
      var p = {x: index.get(0), y: index.get(1)};
      scissors.doTraining(p);
      // add the initial point to the path
      var p0 = new dwv.math.Point2D(index.get(0), index.get(1));
      path.addPoint(p0);
      path.addControlPoint(p0);
    } else {
      // final point: at 'tolerance' of the initial point
      if ((Math.abs(index.get(0) - self.x0) < tolerance) &&
        (Math.abs(index.get(1) - self.y0) < tolerance)) {
        // draw
        self.mousemove(event);
        // listen
        command.onExecute = fireEvent;
        command.onUndo = fireEvent;
        // debug
        dwv.logger.debug('[livewire] finialise path.');
        // save command in undo stack
        app.addToUndoStack(command);
        // set flag
        self.started = false;
      } else {
        // anchor point
        path = currentPath;
        clearParentPoints(imageSize);
        var pn = {x: index.get(0), y: index.get(1)};
        scissors.doTraining(pn);
        path.addControlPoint(currentPath.getPoint(0));
      }
    }
  };

  /**
   * Handle mouse move event.
   *
   * @param {object} event The mouse move event.
   */
  this.mousemove = function (event) {
    if (!self.started) {
      return;
    }
    var layerDetails = dwv.gui.getLayerDetailsFromEvent(event);
    var layerGroup = app.getLayerGroupById(layerDetails.groupId);
    var viewLayer = layerGroup.getActiveViewLayer();
    var index = viewLayer.displayToPlaneIndex(event._x, event._y);

    // set the point to find the path to
    var p = {x: index.get(0), y: index.get(1)};
    scissors.setPoint(p);
    // do the work
    var results = 0;
    var stop = false;
    dwv.logger.debug('[livewire] getting ready...');
    while (!parentPoints[p.y][p.x] && !stop) {
      results = scissors.doWork();

      if (results.length === 0) {
        stop = true;
      } else {
        // fill parents
        for (var i = 0; i < results.length - 1; i += 2) {
          var _p = results[i];
          var _q = results[i + 1];
          parentPoints[_p.y][_p.x] = _q;
        }
      }
    }
    dwv.logger.debug('[livewire] ready!');

    // get the path
    currentPath = new dwv.math.Path();
    stop = false;
    while (p && !stop) {
      currentPath.addPoint(new dwv.math.Point2D(p.x, p.y));
      if (!parentPoints[p.y]) {
        stop = true;
      } else {
        if (!parentPoints[p.y][p.x]) {
          stop = true;
        } else {
          p = parentPoints[p.y][p.x];
        }
      }
    }
    currentPath.appenPath(path);

    // remove previous draw
    if (shapeGroup) {
      shapeGroup.destroy();
    }
    // create shape
    var factory = new dwv.tool.draw.RoiFactory();
    shapeGroup = factory.create(currentPath.pointArray, self.style);
    shapeGroup.id(dwv.math.guid());

    var drawLayer = layerGroup.getActiveDrawLayer();
    var drawController = drawLayer.getDrawController();

    // get the position group
    var posGroup = drawController.getCurrentPosGroup();
    // add shape group to position group
    posGroup.add(shapeGroup);

    // draw shape command
    command = new dwv.tool.DrawGroupCommand(shapeGroup, 'livewire',
      drawLayer.getKonvaLayer());
    // draw
    command.execute();
  };

  /**
   * Handle mouse up event.
   *
   * @param {object} _event The mouse up event.
   */
  this.mouseup = function (_event) {
    // nothing to do
  };

  /**
   * Handle mouse out event.
   *
   * @param {object} event The mouse out event.
   */
  this.mouseout = function (event) {
    // treat as mouse up
    self.mouseup(event);
  };

  /**
   * Handle double click event.
   *
   * @param {object} _event The double click event.
   */
  this.dblclick = function (_event) {
    dwv.logger.debug('[livewire] dblclick');
    // save command in undo stack
    app.addToUndoStack(command);
    // set flag
    self.started = false;
  };

  /**
   * Handle touch start event.
   *
   * @param {object} event The touch start event.
   */
  this.touchstart = function (event) {
    // treat as mouse down
    self.mousedown(event);
  };

  /**
   * Handle touch move event.
   *
   * @param {object} event The touch move event.
   */
  this.touchmove = function (event) {
    // treat as mouse move
    self.mousemove(event);
  };

  /**
   * Handle touch end event.
   *
   * @param {object} event The touch end event.
   */
  this.touchend = function (event) {
    // treat as mouse up
    self.mouseup(event);
  };

  /**
   * Handle key down event.
   *
   * @param {object} event The key down event.
   */
  this.keydown = function (event) {
    event.context = 'dwv.tool.Livewire';
    app.onKeydown(event);
  };

  /**
   * Activate the tool.
   *
   * @param {boolean} bool The flag to activate or not.
   */
  this.activate = function (bool) {
    // start scissors if displayed
    if (bool) {
      var layerGroup = app.getActiveLayerGroup();
      var viewLayer = layerGroup.getActiveViewLayer();

      //scissors = new dwv.math.Scissors();
      var imageSize = viewLayer.getViewController().getImageSize();
      scissors.setDimensions(
        imageSize.get(0),
        imageSize.get(1));
      scissors.setData(viewLayer.getImageData().data);

      // init with the app window scale
      this.style.setBaseScale(app.getBaseScale());
      // set the default to the first in the list
      this.setFeatures({shapeColour: this.style.getLineColour()});
    }
  };

  /**
   * Initialise the tool.
   */
  this.init = function () {
    // does nothing
  };

  /**
   * Add an event listener to this class.
   *
   * @param {string} type The event type.
   * @param {object} callback The method associated with the provided
   *    event type, will be called with the fired event.
   */
  this.addEventListener = function (type, callback) {
    listenerHandler.add(type, callback);
  };
  /**
   * Remove an event listener from this class.
   *
   * @param {string} type The event type.
   * @param {object} callback The method associated with the provided
   *   event type.
   */
  this.removeEventListener = function (type, callback) {
    listenerHandler.remove(type, callback);
  };
  /**
   * Fire an event: call all associated listeners with the input event object.
   *
   * @param {object} event The event to fire.
   * @private
   */
  function fireEvent(event) {
    listenerHandler.fireEvent(event);
  }

}; // Livewire class

/**
 * Help for this tool.
 *
 * @returns {object} The help content.
 */
dwv.tool.Livewire.prototype.getHelpKeys = function () {
  return {
    title: 'tool.Livewire.name',
    brief: 'tool.Livewire.brief'
  };
};

/**
 * Set the tool live features: shape colour.
 *
 * @param {object} features The list of features.
 */
dwv.tool.Livewire.prototype.setFeatures = function (features) {
  if (typeof features.shapeColour !== 'undefined') {
    this.style.setLineColour(features.shapeColour);
  }
};


import pubSubServiceInterface from '../_shared/pubSubServiceInterface';
import sortBy from '../../utils/sortBy';
import ProtocolEngine from './ProtocolEngine';

const EVENTS = {
  STAGE_CHANGE: 'event::hanging_protocol_stage_change',
  NEW_LAYOUT: 'event::hanging_protocol_new_layout',
  CUSTOM_IMAGE_LOAD_PERFORMED:
    'event::hanging_protocol_custom_image_load_performed',
};

class HangingProtocolService {
  studies: object[];
  protocols: object[];
  protocol: object;
  stage: number;
  _commandsManager: object;
  ProtocolEngine: object;
  matchDetails: object[];
  hpAlreadyApplied: boolean[] = [];
  customViewportSettings = [];
  displaySets = [];
  activeStudy: object;
  customAttributeRetrievalCallbacks = {
    NumberOfStudyRelatedSeries: {
      name: 'The number of series in the study',
      // TODO - make this number of display sets instead, if available
      callback: metadata =>
        metadata.NumberOfStudyRelatedSeries ?? metadata.series?.length,
    },
    NumberOfSeriesRelatedInstances: {
      name: 'The number of instances in the display set',
      callback: metadata => metadata.numImageFrames,
    },
    ModalitiesInStudy: {
      name: 'Gets the array of the modalities for the series',
      callback: metadata =>
        metadata.ModalitiesInStudy ??
        (metadata.series || []).reduce((prev, curr) => {
          const { Modality } = curr;
          if (Modality && prev.indexOf(Modality) == -1) prev.push(Modality);
          return prev;
        }, []),
    },
  };
  listeners = {};
  registeredImageLoadStrategies = {};
  activeImageLoadStrategyName = null;
  customImageLoadPerformed = false;

  /**
   * displaySetMatchDetails = <displaySetId, match>
   * DisplaySetId is the id defined in the hangingProtocol
   * match is an object that contains information about
   *
   * {
   *   SeriesInstanceUID,
   *   StudyInstanceUID,
   *   matchDetails,
   *   matchingScore,
   *   sortingInfo
   * }
   */
  displaySetMatchDetails = new Map();

  constructor(commandsManager) {
    this._commandsManager = commandsManager;
    this.protocols = [];
    this.ProtocolEngine = undefined;
    this.protocol = undefined;
    this.stage = undefined;
    /**
     * An array that contains for each viewport (viewportIndex) specified in the
     * hanging protocol, an object of the form
     *
     * {
     *   viewportOptions,
     *   displaySetsInfo, // contains array of  [ { SeriesInstanceUID, displaySetOPtions}, ... ]
     * }
     */
    this.matchDetails = [];
    this.studies = [];
    Object.defineProperty(this, 'EVENTS', {
      value: EVENTS,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    Object.assign(this, pubSubServiceInterface);
  }

  public reset() {
    this.studies = [];
    this.protocols = [];
    this.hpAlreadyApplied = [];
    this.matchDetails = [];
    // this.ProtocolEngine.reset()
  }

  public getDisplaySetsMatchDetails() {
    return this.displaySetMatchDetails;
  }

  public getState() {
    return [this.matchDetails, this.hpAlreadyApplied];
  }

  public getProtocols() {
    return this.protocols;
  }

  public addProtocols(protocols) {
    protocols.forEach(protocol => {
      if (this.protocols.indexOf(protocol) === -1) {
        this.protocols.push(this._validateProtocol(protocol));
      }
    });
  }

  /**
   * Run the hanging protocol decisions tree on the active study,
   * studies list and display sets, firing a hanging protocol event when
   * complete to indicate the hanging protocol is ready.
   *
   * @param params is the dataset to run the hanging protocol on.
   * @param params.activeStudy is the "primary" study to hang  This may or may
   *        not be displayed by the actual viewports.
   * @param params.studies is the list of studies to hang
   * @param params.displaySets is the list of display sets associated with
   *        the studies to display in viewports.
   * @param protocol is a specific protocol to apply.
   * @returns
   */
  public run({ studies, displaySets, activeStudy }, protocol) {
    this.studies = [...studies];
    this.displaySets = displaySets;
    this.activeStudy = activeStudy || studies[0];

    this.ProtocolEngine = new ProtocolEngine(
      this.protocols,
      this.customAttributeRetrievalCallbacks
    );

    // if there is no pre-defined protocol
    if (!protocol || protocol.id === undefined) {
      const matchedProtocol = this.ProtocolEngine.run({
        studies: this.studies,
        activeStudy,
        displaySets,
      });
      this._setProtocol(matchedProtocol);
      return;
    }

    this._setProtocol(protocol);
  }

  /**
   * Returns true, if the hangingProtocol has a custom loading strategy for the images
   * and its callback has been added to the HangingProtocolService
   * @returns {boolean} true
   */
  public hasCustomImageLoadStrategy() {
    return (
      this.activeImageLoadStrategyName !== null &&
      this.registeredImageLoadStrategies[
        this.activeImageLoadStrategyName
      ] instanceof Function
    );
  }

  public getCustomImageLoadPerformed() {
    return this.customImageLoadPerformed;
  }

  /**
   * Set the strategy callback for loading images to the HangingProtocolService
   * @param {string} name strategy name
   * @param {Function} callback image loader callback
   */
  public registerImageLoadStrategy(name, callback) {
    if (callback instanceof Function && name) {
      this.registeredImageLoadStrategies[name] = callback;
    }
  }

  public setHangingProtocolAppliedForViewport(i) {
    this.hpAlreadyApplied[i] = true;
  }

  /**
   * Adds a custom setting that can be chosen in the HangingProtocol UI and applied to a Viewport
   * It is possible to add more than one setting to a given id, in which case all are called.
   * @param id The ID used to refer to the setting (e.g. 'displayCADMarkers')
   * @param name The name of the setting to be displayed (e.g. 'Display CAD Markers')
   * @param callback A function to be run after a viewport is rendered with a series
   * @param store A function to be called to store custom viewport options when switching images/display sets
   *      on a viewport defined by a hanging protocol.
   * @param options A set of values added to the "this" object for options for the callback/store
   */
  public addCustomViewportOption(id, name, callback, store, options) {
    this.customViewportSettings.push({ id, name, store, callback, options });
  }

  /** Do the inverse store operation to store information between views.
   * @params viewportOptions is the new viewport options to apply.
   *     This object will be modified by the call.
   * @params priorViewportOptions is the previous set of options, if any
   * @params ...args is any other args passed by the caller.
   */
  public applyCustomViewportStore(
    viewportOptions,
    priorViewportOptions,
    ...args
  ) {
    if (!priorViewportOptions) return;
    for (const setting of this.customViewportSettings) {
      if (!setting.store) continue;
      setting.store(viewportOptions, priorViewportOptions, ...args);
    }
  }

  /** Applies the viewport options.
   * This will iterate through the custom viewport options and call
   * the callbacks for each one which matches.
   */
  public applyCustomViewportOptions(viewportOptions, viewport, ...args) {
    const { customViewportOptions } = viewportOptions;
    if (!customViewportOptions) return;
    Object.keys(customViewportOptions).forEach(key => {
      this.applyCustomViewportOption(
        key,
        customViewportOptions[key],
        viewport,
        ...args
      );
    });
  }

  protected applyCustomViewportOption(id, value, viewport, ...args) {
    let callCount = 0;
    for (const setting of this.customViewportSettings) {
      // Can have pure storage settings as well.
      if (setting.id !== id || !setting.callback) continue;
      setting.callback(id, value, viewport, ...args);
      callCount += 1;
    }
    if (callCount === 0) console.warn('No custom setting found for', id);
  }

  /**
   * Adds a custom attribute to be used in the HangingProtocol UI and matching rules, including a
   * callback that will be used to calculate the attribute value.
   *
   * @param attributeId The ID used to refer to the attribute (e.g. 'timepointType')
   * @param attributeName The name of the attribute to be displayed (e.g. 'Timepoint Type')
   * @param callback The function used to calculate the attribute value from the other attributes at its level (e.g. study/series/image)
   * @param options to add to the "this" object for the custom attribute retriever
   */
  public addCustomAttribute(attributeId, attributeName, callback, options) {
    this.customAttributeRetrievalCallbacks[attributeId] = {
      ...options,
      id: attributeId,
      name: attributeName,
      callback,
    };
  }

  /**
   * Switches to the next protocol stage in the display set sequence
   */
  public nextProtocolStage() {
    console.log('ProtocolEngine::nextProtocolStage');

    if (!this._setCurrentProtocolStage(1)) {
      console.log('ProtocolEngine::nextProtocolStage failed');
    }
  }

  /**
   * Switches to the previous protocol stage in the display set sequence
   */
  public previousProtocolStage() {
    console.log('ProtocolEngine::previousProtocolStage');

    if (!this._setCurrentProtocolStage(-1)) {
      console.log('ProtocolEngine::previousProtocolStage failed');
    }
  }

  /**
   * Executes the callback function for the custom loading strategy for the images
   * if no strategy is set, the default strategy is used
   */
  runImageLoadStrategy(data) {
    const loader = this.registeredImageLoadStrategies[
      this.activeImageLoadStrategyName
    ];
    const loadedData = loader({
      data,
      displaySetsMatchDetails: this.getDisplaySetsMatchDetails(),
      matchDetails: this.matchDetails,
    });

    // if loader successfully re-arranged the data with the custom strategy
    // and returned the new props, then broadcast them
    if (!loadedData) {
      return;
    }

    this.customImageLoadPerformed = true;
    this._broadcastChange(this.EVENTS.CUSTOM_IMAGE_LOAD_PERFORMED, loadedData);
  }

  _validateProtocol(protocol) {
    protocol.id = protocol.id || protocol.name;
    // Automatically compute some number of attributes if they
    // aren't present.  Makes defining new HPs easier.
    protocol.name = protocol.name || protocol.id;
    const { stages } = protocol;

    // Generate viewports automatically as required.
    stages.forEach(stage => {
      if (!stage.viewports) {
        stage.viewports = [];
        const { rows, columns } = stage.viewportStructure.properties;

        for (let i = 0; i < rows * columns; i++) {
          stage.viewports.push({
            viewportOptions: {},
            displaySets: [],
          });
        }
      } else {
        stage.viewports.forEach(viewport => {
          viewport.viewportOptions = viewport.viewportOptions || {};
          if (!viewport.displaySets) {
            viewport.displaySets = [];
          } else {
            viewport.displaySets.forEach(displaySet => {
              displaySet.options = displaySet.options || {};
            });
          }
        });
      }
    });

    return protocol;
  }

  _setProtocol(protocol) {
    // TODO: Add proper Protocol class to validate the protocols
    // which are entered manually
    this.stage = 0;
    this.protocol = protocol;
    const { imageLoadStrategy } = protocol;
    if (imageLoadStrategy) {
      // check if the imageLoadStrategy is a valid strategy
      if (
        this.registeredImageLoadStrategies[imageLoadStrategy] instanceof
        Function
      ) {
        this.activeImageLoadStrategyName = imageLoadStrategy;
      }
    }
    this._updateViewports();
  }

  /**
   * Retrieves the number of Stages in the current Protocol or
   * undefined if no protocol or stages are set
   */
  _getNumProtocolStages() {
    if (
      !this.protocol ||
      !this.protocol.stages ||
      !this.protocol.stages.length
    ) {
      return;
    }

    return this.protocol.stages.length;
  }

  /**
   * Retrieves the current Stage from the current Protocol and stage index
   *
   * @returns {*} The Stage model for the currently displayed Stage
   */
  _getCurrentStageModel() {
    return this.protocol.stages[this.stage];
  }

  /**
   * Updates the viewports with the selected protocol stage.
   */
  _updateViewports() {
    // Make sure we have an active protocol with a non-empty array of display sets
    if (!this._getNumProtocolStages()) {
      console.log('No protocol stages - nothing to display');
      return;
    }

    // reset displaySetMatchDetails
    this.displaySetMatchDetails = new Map();

    // Retrieve the current stage
    const stageModel = this._getCurrentStageModel();

    // If the current stage does not fulfill the requirements to be displayed,
    // stop here.
    if (
      !stageModel ||
      !stageModel.viewportStructure ||
      !stageModel.viewports ||
      !stageModel.displaySets ||
      !stageModel.viewports.length
    ) {
      console.log('Stage cannot be applied', stageModel);
      return;
    }

    this.customImageLoadPerformed = false;
    const { type: layoutType } = stageModel.viewportStructure;

    // Retrieve the properties associated with the current display set's viewport structure template
    // If no such layout properties exist, stop here.
    const layoutProps = stageModel.viewportStructure.properties;
    if (!layoutProps) {
      console.log('No viewportStructure.properties in', stageModel);
      return;
    }

    const { columns: numCols, rows: numRows, layoutOptions = [] } = layoutProps;

    this._broadcastChange(this.EVENTS.NEW_LAYOUT, {
      layoutType,
      numRows,
      numCols,
      layoutOptions,
    });

    // Matching the displaySets

    stageModel.displaySets.forEach(displaySet => {
      const { bestMatch, matchingScores } = this._matchImages(displaySet);
      this.displaySetMatchDetails.set(displaySet.id, bestMatch);
      if (bestMatch) {
        bestMatch.matchingScores = matchingScores;
      }
    });

    // Loop through each viewport
    stageModel.viewports.forEach((viewport, viewportIndex) => {
      const { viewportOptions } = viewport;
      this.hpAlreadyApplied.push(false);

      // DisplaySets for the viewport, Note: this is not the actual displaySet,
      // but it is a info to locate the displaySet from the displaySetService
      const displaySetsInfo = [];
      viewport.displaySets.forEach(
        ({ id, displaySetIndex = 0, options: displaySetOptions }) => {
          const viewportDisplaySetMain = this.displaySetMatchDetails.get(id);
          // Use the display set index to allow getting the "next" match, eg
          // matching all display sets, and get the displaySetIndex'th item
          const viewportDisplaySet =
            !viewportDisplaySetMain || displaySetIndex === 0
              ? viewportDisplaySetMain
              : viewportDisplaySetMain.matchingScores[displaySetIndex];

          if (viewportDisplaySet) {
            const {
              SeriesInstanceUID,
              displaySetInstanceUID,
            } = viewportDisplaySet;

            const displaySetInfo = {
              SeriesInstanceUID,
              displaySetInstanceUID,
              displaySetOptions,
            };

            // console.log("Choose displaySetInstanceUID", displaySetInstanceUID, SeriesInstanceUID);
            displaySetsInfo.push(displaySetInfo);
          } else {
            console.warn(
              `
             The hanging protocol viewport is requesting to display ${id} displaySet that is not
             matched based on the provided criteria (e.g. matching rules).
            `
            );
          }
        }
      );

      this.matchDetails[viewportIndex] = {
        viewportOptions,
        displaySetsInfo,
      };
    });
  }

  // Match images given a list of Studies and a Viewport's image matching reqs
  _matchImages(displaySetRules) {
    // TODO: matching is applied on study and series level, instance
    // level matching needs to be added in future

    // Todo: handle fusion viewports by not taking the first displaySet rule for the viewport
    const {
      studyMatchingRules = [],
      seriesMatchingRules,
      findAll = false,
    } = displaySetRules;

    const matchingScores = [];
    let highestStudyMatchingScore = 0;
    let highestSeriesMatchingScore = 0;

    console.log(
      'ProtocolEngine::matchImages',
      studyMatchingRules,
      seriesMatchingRules
    );
    this.studies.forEach(study => {
      // TODO - only pass in display sets matching the top level study being tested
      const studyMatchDetails = this.ProtocolEngine.findMatch(
        study,
        studyMatchingRules,
        { studies: this.studies, displaySets: this.displaySets }
      );

      // Prevent bestMatch from being updated if the matchDetails' required attribute check has failed
      if (studyMatchDetails.requiredFailed === true) {
        return;
      }

      highestStudyMatchingScore = studyMatchDetails.score;

      // console.log("study", study.StudyInstanceUID, "display sets #", this.displaySets.length);
      this.displaySets.forEach(displaySet => {
        const {
          StudyInstanceUID,
          SeriesInstanceUID,
          displaySetInstanceUID,
        } = displaySet;
        if (StudyInstanceUID !== study.StudyInstanceUID) return;
        const seriesMatchDetails = this.ProtocolEngine.findMatch(
          displaySet,
          seriesMatchingRules,
          { studies: this.studies, instance: displaySet.images?.[0] }
        );

        // Prevent bestMatch from being updated if the matchDetails' required attribute check has failed
        if (seriesMatchDetails.requiredFailed === true) {
          // console.log("Display set required failed", displaySet, seriesMatchingRules);
          return;
        }

        // console.log("Found displaySet for rules", displaySet);
        highestSeriesMatchingScore = Math.max(
          seriesMatchDetails.score,
          highestSeriesMatchingScore
        );

        const matchDetails = {
          passed: [],
          failed: [],
        };

        matchDetails.passed = matchDetails.passed.concat(
          seriesMatchDetails.details.passed
        );
        matchDetails.passed = matchDetails.passed.concat(
          studyMatchDetails.details.passed
        );

        matchDetails.failed = matchDetails.failed.concat(
          seriesMatchDetails.details.failed
        );
        matchDetails.failed = matchDetails.failed.concat(
          studyMatchDetails.details.failed
        );

        const totalMatchScore =
          seriesMatchDetails.score + studyMatchDetails.score;

        const imageDetails = {
          StudyInstanceUID,
          SeriesInstanceUID,
          displaySetInstanceUID,
          matchingScore: totalMatchScore,
          matchDetails: matchDetails,
          sortingInfo: {
            score: totalMatchScore,
            study: study.StudyInstanceUID,
            series: parseInt(displaySet.SeriesNumber),
          },
        };

        // console.log("Adding display set", displaySet, imageDetails);
        matchingScores.push(imageDetails);
      });
    });

    if (matchingScores.length === 0) {
      console.log('No match found');
    }

    // Sort the matchingScores
    const sortingFunction = sortBy(
      {
        name: 'score',
        reverse: true,
      },
      {
        name: 'study',
        reverse: true,
      },
      {
        name: 'series',
      }
    );
    matchingScores.sort((a, b) =>
      sortingFunction(a.sortingInfo, b.sortingInfo)
    );

    const bestMatch = matchingScores[0];

    // console.log('ProtocolEngine::matchImages bestMatch', bestMatch, matchingScores);

    return {
      bestMatch,
      matchingScores,
    };
  }

  /**
   * Check if the next stage is available
   * @return {Boolean} True if next stage is available or false otherwise
   */
  _isNextStageAvailable() {
    const numberOfStages = this._getNumProtocolStages();

    return this.stage + 1 < numberOfStages;
  }

  /**
   * Check if the previous stage is available
   * @return {Boolean} True if previous stage is available or false otherwise
   */
  _isPreviousStageAvailable() {
    return this.stage - 1 >= 0;
  }

  /**
   * Changes the current stage to a new stage index in the display set sequence.
   * It checks if the next stage exists.
   *
   * @param {Integer} stageAction An integer value specifying wheater next (1) or previous (-1) stage
   * @return {Boolean} True if new stage has set or false, otherwise
   */
  _setCurrentProtocolStage(stageAction) {
    //reseting the applied protocols
    this.hpAlreadyApplied = [];
    // Check if previous or next stage is available
    if (stageAction === -1 && !this._isPreviousStageAvailable()) {
      return false;
    } else if (stageAction === 1 && !this._isNextStageAvailable()) {
      return false;
    }

    // Sets the new stage
    this.stage += stageAction;

    // Log the new stage
    console.log(
      `ProtocolEngine::setCurrentProtocolStage stage = ${this.stage}`
    );

    // Since stage has changed, we need to update the viewports
    // and redo matchings
    this._updateViewports();

    // Everything went well
    this._broadcastChange(this.EVENTS.STAGE_CHANGE, {
      matchDetails: this.matchDetails,
      hpAlreadyApplied: this.hpAlreadyApplied,
    });
    return true;
  }
  /**
   * Broadcasts hanging protocols changes.
   *
   * @param {string} eventName The event name.add
   * @param {object} eventData.source The measurement source.
   * @param {object} eventData.measurement The measurement.
   * @param {boolean} eventData.notYetUpdatedAtSource True if the measurement was edited
   *      within the measurement service and the source needs to update.
   * @return void
   */
  // Todo: why do we have a separate broadcastChange function here?
  _broadcastChange(eventName, eventData) {
    const hasListeners = Object.keys(this.listeners).length > 0;
    const hasCallbacks = Array.isArray(this.listeners[eventName]);

    if (hasListeners && hasCallbacks) {
      this.listeners[eventName].forEach(listener => {
        listener.callback(eventData);
      });
    }
  }
}

export default HangingProtocolService;
export { EVENTS };
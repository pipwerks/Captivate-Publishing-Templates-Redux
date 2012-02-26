/*global RightClick, swfobject */
/* scorm_support.js, rewritten by Philip Hutchison, January 2012
   version 1.20120226
   http://pipwerks.com/2012/01/11/cleaning-up-adobe-captivates-scorm-publishing-template-part-1-introduction/
*/

var CONFIG = {},
    flashvars = {},
    params = {},
    attributes = {},
    customJavaScript,
    SCORM_API = null,
    unloaded = false,
    isInitialized = false,
    isTerminated = false,
    courseStatus,
    entryStatus,
    value_store = [],
    lastCommand,
    setValueWasSuccessful = true,
    CaptivateSWF, //Cache the reference to the SWF to avoid future lookups
    logEvent,
    isCached,
    findAPI,
    getAPI,
    Captivate_DoExternalInterface,
    displayScormFailureMessage,
    initializeSCORM,
    swfobjectCallbackHandler,
    createWrapper,
    unloadHandler,
    initializeCourse;


/*
    logEvent(msg)
    Writes a message to console.log, if available, and if
    CONFIG.logEvents is set to true (value set in Default.htm)

    Parameters: msg (string)
    Returns:     none
*/

logEvent = function (msg){
    if(CONFIG.logEvents && window.console && window.console.log){
        window.console.log(msg);
    }
};


/*
   isCached(property, value)
   Caches CMI value to help prevent sending duplicate data to LMS.

   Parameters: property (CMI property name), value (CMI value, normally a string)
   Returns:    boolean indicating whether prop/value pair is in the CMI cache.
*/

isCached = function(property, value){

    //Ensure we have a valid property to work with
    if(typeof property === "undefined" || typeof value === "undefined"){ return false; }

    //Replace all periods in CMI property names so we don't run into JS errors
    property = property.replace(/\./g,'_');

    //If prop/value pair is cached, return true
    if(typeof value_store[property] !== "undefined" && value_store[property] === value){
        return true;
    }

    //Otherwise add to cache
    value_store[property] = value;

    return false;

};


/*
   findAPI(window)
   Adapted from pipwerks SCORM wrapper
   https://github.com/pipwerks/scorm-api-wrapper

   Looks for an object named API in parent and opener windows

   Parameters: window (the browser window object).
   Returns:    Object if API is found, null if no API found
*/

findAPI = function(win){

    var API,
        findAttempts = 0,
        findAttemptLimit = 500;

    while (!win.API_1484_11 && win.parent && win.parent != win && findAttempts <= findAttemptLimit){
        findAttempts++;
        win = win.parent;
    }

    API = win.API_1484_11 || null;

    return API;

};


/*
   getAPI()
   Adapted from pipwerks SCORM wrapper
   https://github.com/pipwerks/scorm-api-wrapper

   Looks for an object named API_1484_11, first in the current window's frame
   hierarchy and then, if necessary, in the current window's opener window
   hierarchy (if there is an opener window).

   Parameters:  None.
   Returns:     Object if API found, null if no API found
*/

getAPI = function(){

    var API = null,
        win = window;

    //Look in parent windows first
    if(win.parent && win.parent != win){
        API = findAPI(win.parent);
    }

    //Look in opener windows next
    if(!API && win.top.opener){
        API = findAPI(win.top.opener);
    }

    //Plateau LMS needs special hand-holding
    if(!API && win.top.opener && win.top.opener.document) {
        API = findAPI(win.top.opener.document);
    }

    return API;

};


/*
   Captivate_DoExternalInterface(command, parameter, value, variable)
   Invoked by Captivate SWF via ExternalInterface
   Sends data to LMS via SCORM.
   Originally created by Adobe, heavily modified by pipwerks

   Parameters:  command (get, set, initialize, etc.)
                parameter (SCORM cmi element to get or set)
                value (value of cmi element)
                variable (the name of the variable within the Captivate SWF)

   Returns:     strErr (a string indicating success of call)
*/

Captivate_DoExternalInterface = function (command, parameter, value, variable) {

    logEvent("Captivate_DoExternalInterface. command: " +command +", parameter: " +parameter +", value: '" +value +"', variable: " +variable);

    var strErr = "true",
        intercept = false;

    //Ensure SCORM API was initialized before attemptng communicaton
    if(!isInitialized){ return; }

    switch(command){

        case "Initialize":

            logEvent(" -- SCORM_API.Initialize cancelled: already initialized.");
            break; //We already initialized, just nod politely and tell the SWF everything is okay!

        case "SetValue":

            if(parameter === "cmi.completion_status"){ courseStatus = value; }

            //Only send value to LMS if it hasn't already been sent;
            //If value is cached and matches what is about to be sent
            //to the LMS, prevent value from being sent a second time.
            if(!isCached(parameter, value)){

                logEvent(" -- SetValue. '" +parameter + "' not cached. Setting value: '" +value +"'");
                strErr = SCORM_API.SetValue(parameter, value);
                setValueWasSuccessful = (strErr === "true");

            } else {

                //Fakin' it for Captivate's sake.
                setValueWasSuccessful = true;
                logEvent(" -- SetValue cancelled: specified value is already set in LMS. " +parameter +", " +value);

            }

            break;

        case "GetValue":

            /*

                Captivate asks for a few things when initializing:

                    cmi.entry
                    cmi.location
                    cmi.score._children
                    cmi.suspend_data
                    cmi.interactions._children
                    cmi.interactions._count
                    cmi.launch_data
                    cmi.objectives._count
                    cmi.score.scaled
                    cmi.score.min
                    cmi.score.max
                    cmi.score.raw

               If the course is being launched for the very first time, SCORM requires cmi.entry to return "ab-initio".
               This means there will be no pre-existing data, such as cmi.location, suspend_data, or score.
               We should therefore prevent Captivate from asking for these items, because it will throw a pointless error in the LMS.

            */

            if(entryStatus === "ab-initio" && /location|suspend_data|score/g.test(parameter)){

                logEvent(" -- SCORM_API.GetValue cancelled: The LMS will return an error if '" +parameter +"' is called when the course entry status is ab-initio.");
                strErr = "";

            } else {

                strErr = SCORM_API.GetValue(parameter);

            }

            break;

        case "Terminate":

            if(isTerminated){

                logEvent(" -- SCORM_API.Terminate cancelled: Already terminated.");

            } else {

                strErr = SCORM_API.Terminate("");
                isTerminated = (strErr === "true");

            }

            break;

        case "Commit": strErr = SCORM_API.Commit(""); break;

        case "GetLastError":

            if(lastCommand === "SetValue" && setValueWasSuccessful){

                strErr = "";
                logEvent(" -- SCORM_API.GetLastError cancelled: redundant call.");

            } else {

                strErr = SCORM_API.GetLastError();

            }

            break;

        default:

            if(value && value.length > 0){
                strErr = SCORM_API[command](parameter);
            }

    }

    CaptivateSWF.SetScormVariable(variable, strErr);

    lastCommand = command;

    return strErr;

};


/*
   displayScormFailureMessage()
   Display a custom message to learner if SCORM fails to initialize.
   The value of CONFIG.scormUnavailableMessage is set in Default.htm

   Parameters:  none
   Returns:     none
*/

displayScormFailureMessage = function (){
    document.getElementById(CONFIG.targetElementID).innerHTML = CONFIG.scormUnavailableMessage;
};


/*
   initializeSCORM()
   Initializes the SCORM connection as soon as the HTML page has loaded.
   The original Captivate code waited until the SWF loaded to initialize;
   this modified template starts the connection much earlier in an attempt
   to improve performance.

   Immediately sets completion status to incomplete if this is a 1st attempt

   Parameters:  none
   Returns:     none
*/

initializeSCORM = function (){

    if(!SCORM_API){
        if(CONFIG.requireSCORMAPI){ displayScormFailureMessage(); }
        return;
    }

    isInitialized = SCORM_API.Initialize("");

if(isInitialized){
        courseStatus = SCORM_API.GetValue("cmi.completion_status");
    entryStatus = SCORM_API.GetValue("cmi.entry");
        if(courseStatus === "not attempted"){
            SCORM_API.SetValue("cmi.completion_status", "incomplete");
            logEvent("cmi.completion_status automatically set to 'incomplete' by wrapper");
        }
    } else {
        displayScormFailureMessage();
    }

};


/*
   swfobjectCallbackHandler(e)
   Used by SWFObject to invoke JavaScript once the <object> has been written
   to the HTML. Does NOT indicate the SWF has finished loading!

   Parameters:  e (event)
   Returns:     none
*/

swfobjectCallbackHandler = function (e){

    //e.ref is the <object> aka SWF file. No need for getElementById
    if(e.success && e.ref){

        CaptivateSWF = e.ref; //Set global reference to Captivate SWF for future use
        CaptivateSWF.tabIndex = -1; //Set tabIndex to enable focus on non-form elements
        CaptivateSWF.focus(); //Set focus on <object> aka SWF

        //Enable RightClick functionality, if needed.
        if(CONFIG.enableRightClick !== ""){ RightClick.init(); }

        //Initialize the SCORM API, don't wait for the SWF to do it.
        initializeSCORM();

        //If SCORM fails to initialize, kill the course.
        if(CONFIG.requireSCORMAPI && !isInitialized){ return; }

        //Fix the centering for the SWF, if needed.
        if(CONFIG.centerSWF){
            document.getElementsByTagName("body")[0].className = "centered";
            CaptivateSWF.style.marginTop = "-" +(CONFIG.swfHeight / 2) +"px";
            CaptivateSWF.style.marginLeft = "-" +(CONFIG.swfWidth / 2) +"px";
        }

        //Invoke any custom JavaScript, if needed.
        //"customJavaScript" function is found in Default.htm
        //We have wrapped it in a timer that ensure the code is
        //not executed until the SWF has finished loading.
        //See http://learnswfobject.com/advanced-topics/executing-javascript-when-the-swf-has-finished-loading/

        if(customJavaScript && typeof customJavaScript === "function"){

            //This timeout ensures we don't try to access PercentLoaded too soon
            var initialTimeout = setTimeout(function (){
                //Ensure Flash Player's PercentLoaded method is available and returns a value
                if(typeof CaptivateSWF.PercentLoaded !== "undefined" && CaptivateSWF.PercentLoaded()){
                    //Set up a timer to periodically check value of PercentLoaded
                    var loadCheckInterval = setInterval(function (){
                        //Once value == 100 (fully loaded) we can do whatever we want
                        if(CaptivateSWF.PercentLoaded() === 100){
                            //Execute function
                            customJavaScript();
                            //Clear timer
                            clearInterval(loadCheckInterval);
                        }
                    }, 1500);
                }
            }, 200);

        }

    }
};


/*
   createWrapper(existing_div_ID, wrapper_div_ID)
   Creates a wrapper DIV around the SWF for compatibility with RightClick utility

   Parameters:  existing_div_ID, wrapper_div_ID
   Returns:     none
*/

createWrapper = function (existing_div_ID, wrapper_div_ID){

    var existing_div = document.getElementById(existing_div_ID);

    if(existing_div){

        //Turn the original div into the wrapper div
        existing_div.id = wrapper_div_ID;

        //Create new child element
        var wrapper_div = document.createElement("div");
        wrapper_div.id = existing_div_ID;

        //Place original element inside new element.
        existing_div.appendChild(wrapper_div);

    }

};


/*
   unloadHandler()
   Ensures SCORM connection is properly disconnected when closing browser window

   Parameters:  none
   Returns:     none
*/

unloadHandler = function (){
    if(!unloaded && isInitialized && !isTerminated){
        var exit_status = (courseStatus === "incomplete") ? "suspend" : "normal";
        SCORM_API.SetValue("cmi.exit", exit_status); //Set exit to whatever is needed
        SCORM_API.Commit(""); //Ensure that LMS saves all data
        isTerminated = (SCORM_API.Terminate("") === "true"); //close the SCORM API connection properly
        unloaded = true; //Ensure we don't invoke unloadHandler more than once.
    }
};


/*
   initializeCourse()
   Starts SCORM connection and embeds Captivate SWF

   Parameters:  none
   Returns:     none
*/

initializeCourse = function (){

    //Initialize SCORM API
    SCORM_API = getAPI();

    //Only embed SWF if SCORM API is found
    if(CONFIG.requireSCORMAPI && !SCORM_API){

        //Provide a useful error message for the learner. Will only show up if SCORM API is not found!
        displayScormFailureMessage();

    } else {

        //Check to see if right-click functionality
        //is required before embedding SWF
        if(CONFIG.enableRightClick !== ""){

            //Create wrapper around original target element
            createWrapper(CONFIG.targetElementID, "CaptivateContent");

        }

        params.bgcolor = CONFIG.swfBgColor;
        params.menu = (typeof params.menu !== "undefined") ? params.menu : (CONFIG.enableRightClick !== "") ? "false" : "true";
        params.wmode = CONFIG.swfWindowMode;
        attributes.name = CONFIG.targetElementID;

        swfobject.embedSWF(CONFIG.swflocation + "?SCORM_API=1.0&SCORM_TYPE=0",
                           CONFIG.targetElementID,
                           CONFIG.swfWidth,
                           CONFIG.swfHeight,
                           CONFIG.minRequiredFPVersion,
                           false,
                           flashvars,
                           params,
                           attributes,
                           swfobjectCallbackHandler);

    }

};


window.onbeforeunload = unloadHandler;
window.onunload = unloadHandler;
swfobject.addDomLoadEvent(initializeCourse);
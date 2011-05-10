
const APP_NAME = "Chrome Last.fm Scrobbler";
const APP_VERSION = "0.7";

// timeout in ms for ajax requests
const AJAX_TIMEOUT = 5000;

// authentication token retrieved after handshake()
var sessionID = "";

// number of failed authentications after the last successful one
var authFailCounter = 0;

// browser tab with actually scrobbled track
var nowPlayingTab = null;

// "now playing" and "scrobble" urls retrieved in handshake()
var nowPlayingURL = "http://post.audioscrobbler.com:80/np_1.2";
var submissionURL =  "http://post2.audioscrobbler.com:80/protocol_1.2";

// api url
var apiURL = "http://ws.audioscrobbler.com/2.0/?";


// song structure (artist, track, duration, startTime)
var song = null;

/**
 * Notification
 */

const NOTIFICATION_TIMEOUT = 5000;
const NOTIFICATION_SEPARATOR = ':::';

function scrobblerNotification(text, img) {  
	var title = 'Last.fm Scrobbler';
	var body = '';
	var boom = text.split(NOTIFICATION_SEPARATOR);

	if (boom.length === 1) {
		body = boom[0];
	} else {
		title = boom[0];
		body = boom[1];
	}

	var notification = webkitNotifications.createNotification(
		(img || 'icon128.png'),
		title,
		body
	);
	notification.show();
	setTimeout(function() {
		notification.cancel()
	}, NOTIFICATION_TIMEOUT);
}


/**
 * Log in, retrieve sessionID
 */ 
function handshake() {
	if (!localStorage.username || !localStorage.password){
		scrobblerNotification("Oops! Seems like you forgot to fill in your Last.fm credentials.\n\nPlease head to the options page and do so.");
		authFailCounter++;
		return false;
	}
	var username = localStorage.username;
	var password = localStorage.password;

      // check for empty username/password
      if (!username || !password) {
         alert('Oops! Seems like you forgot to fill in your Last.fm credentials.\n\nPlease head to the options page and do so.');
         authFailCounter++;
      }

	var currentTime = parseInt(new Date().getTime() / 1000.0);
	var token = MD5(password + currentTime);
	var http_request = new XMLHttpRequest();
	http_request.onreadystatechange = function() {
		if (http_request.readyState == 4 && http_request.status == 200) {
			switch (http_request.responseText.split("\n")[0]) {
				case 'OK':
					sessionID = http_request.responseText.split("\n")[1];
					nowPlayingURL = http_request.responseText.split("\n")[2];
					submissionURL = http_request.responseText.split("\n")[3];
					authFailCounter = 0;
				break;
				case 'BADAUTH':
					authFailCounter++;
					scrobblerNotification('Authentication failed!\n\nPlease check your username and password in options');
				break;
				default:
					authFailCounter++;
					scrobblerNotification('Last.fm auth server responded with error:\n' + http_request.responseText.split("\n")[0]);
				break;
			}
		}
	}
	http_request.open(
		"GET",
		"http://post.audioscrobbler.com/?hs=true&p=1.2.1&c=chr&v=" + APP_VERSION + "&u=" + username + "&t=" + currentTime + "&a=" + token,
		false);
	http_request.setRequestHeader("Content-Type", "application/xml");
	http_request.send(null);
}


/**
 * Validate song info against last.fm
 * @return bool
 */  
function validate(artist, track) {
   var validationURL = "http://ws.audioscrobbler.com/2.0/?method=track.getinfo&api_key=d9bb1870d3269646f740544d9def2c95&artist=" + encodeURIComponent(artist) + "&track=" + encodeURIComponent(track) + "&autocorrect=1";
   
   var req = new XMLHttpRequest();  
   req.open('GET', validationURL, false);   
   req.send(null);  
   if(req.status == 200) {  
      if (req.responseText != "You must supply either an artist and track name OR a musicbrainz id." && req.responseXML){
		var track = req.responseXML.querySelector('track');
		var album = track.querySelector('album');
         return {
			track: track.querySelector('name').textContent,
			artist: track.querySelector('artist name').textContent,
			album: album ? album.querySelector('title').textContent : null,
			image: album ? album.querySelector('image[size="medium"]').textContent : null
		 };
		}
   }  

   return false;   
}



/**
 * Tell server which song is playing right now (won't be scrobbled yet!)
 * @param sender browser tab
 */ 
function nowPlaying(sender) {
   if (sessionID == '') 
      handshake();

   var params = "s=" + sessionID + "&a=" + song.artist + "&t=" + song.track;

   // these song params may not be set, but all query params has to be passed (even as null)
   params += "&l[0]=" + (typeof(song.duration) != "undefined" ? song.duration : "");
   params += "&b[0]=" + (typeof(song.album) != "undefined" ? song.album : "");
   params += "&m=&n=";
   
   var notifText =  'Now playing' + NOTIFICATION_SEPARATOR + song.artist + " - " + song.track;
   var ajaxTimeout = null; // timeout object

   var http_request = new XMLHttpRequest();
   http_request.onreadystatechange = function() {
         if (http_request.readyState == 4 && http_request.status == 200)
            // need to (re)authenticate
            if (http_request.responseText.split("\n")[0] == "BADSESSION") {
               // prevent looping on constantly failing auth
               if (authFailCounter == 0) {
                  handshake();
                  nowPlaying(sender);
               }
               return;
            }
            else if (http_request.responseText.split("\n")[0] == "OK") {
                  // Confirm the content_script, that the song is "now playing"
                  chrome.tabs.sendRequest(sender.tab.id, {type: "nowPlayingOK"});
                  scrobblerNotification(notifText, song.image);
            } else {
               alert('Last.fm responded with unknown code on nowPlaying request');
            }
            
            clearTimeout(ajaxTimeout);
   };
   http_request.open("POST", nowPlayingURL, true);
   http_request.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
   http_request.send(params);
   
   // timeout
   ajaxTimeout = setTimeout(function(){
      http_request.abort();
      scrobblerNotification("Unable to connect to Last.fm service. Please check your connection");
   }, AJAX_TIMEOUT);      
}

/**
 * Finally scrobble the song, but only if it has been playing long enough.
 * Cleans global variables "song" and "playingTab" on success. 
 * @param sender browser tab
 */ 
function submit(sender) {
   // bad function call
   if (song == null || !song || song.artist == '' || song.track == '') {
      chrome.tabs.sendRequest(sender.tab.id, {type: "submitFAIL", reason: "No song"});
      song = null;
      return;
   }

   // need to (re)authenticate?
   if (sessionID == "")
      handshake();

   var playTime = parseInt(new Date().getTime() / 1000.0) - song.startTime;

   if (playTime > 30 && (typeof(song.duration) == "undefined" || playTime > Math.min(240, song.duration / 2))) {
            var params = "s=" + sessionID + "&a[0]=" + song.artist + "&t[0]=" + song.track + "&i[0]=" + song.startTime + "&o[0]=P";

            // these song params may not be set, but all query params has to be passed (even as null)
            params += "&l[0]=" + (typeof(song.duration) != "undefined" ? song.duration : "");
            params += "&b[0]=" + (typeof(song.album) != "undefined" ? song.album : "");
            params += "&r[0]=&m[0]=&n[0]=";

            var notifText =  'Scrobbled' + NOTIFICATION_SEPARATOR + song.artist + " - " + song.track;
			var notifImg = song.image;

            var http_request = new XMLHttpRequest();

		http_request.onreadystatechange = function() {               
               if (http_request.readyState == 4 && http_request.status == 200) {                  
                  // need to (re)authenticate
                  if (http_request.responseText.split("\n")[0] == "BADSESSION") {
                     handshake();
                     submit(sender);
                  } else if (http_request.responseText.split("\n")[0] == "FAILED") {
                     alert(http_request.responseText);
                  } else {
                     // notification
                     scrobblerNotification(notifText, notifImg);
                     
                     // stats
                     _gaq.push(['_trackEvent', 'Track scrobbled']);
                     
                     // Confirm the content_script, that the song has been scrobbled
                     if (sender)
                        chrome.tabs.sendRequest(sender.tab.id, {type: "submitOK"});
                  }
               }
		};
		http_request.open("POST", submissionURL, true);
		http_request.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
		http_request.send(params);
		
		nowPlayingTab = null;
		song = null;
	} else {
         // song hasn't been playing long enough
         if (sender)
            chrome.tabs.sendRequest(sender.tab.id, {type: "submitFAIL", reason: "Song hasn't been playing long enough"});
      }
}



/**
 * Extension inferface for content_script
 * nowPlaying(artist, track, duration) - send info to server which song is playing right now
 * submit() - scrobble the song previously set as playing
 * xhr(url) - send XHR GET request and return response text
 * newSession() - start a new last.fm session (need to reauthenticate)
 * validate(artist, track) - validate artist-track pair against last.fm and return bool     
 */  
chrome.extension.onRequest.addListener(
	function(request, sender, sendResponse) {            
            switch(request.type) {
   		case "nowPlaying":
      		// if there was a previously playing tab, try to submit it
                  if (nowPlayingTab != null)
                     submit();
               
      		nowPlayingTab = sender.tab.id;
      		

      		song = {"artist"	:	request.artist,
      					"track"	:	request.track,
                                    "album"     :     request.album,
      					"duration"	:	request.duration,
						"image": request.image || null,
      					"startTime"	:	parseInt(new Date().getTime() / 1000.0)
                         };
                         

      		nowPlaying(sender);                  
      		sendResponse({});      		
      		break;
                  
   		case "submit":		
      		submit(sender);                  
      		sendResponse({});      		
      		break;
                  
            case "reset":
                  nowPlayingTab = null;
                  song = null;
                  sendResponse({});
                  break;

            case "trackStats":
      		_gaq.push(['_trackEvent', request.text]);
      		sendResponse({});
      		break;

            case "xhr":
      		var http_request = new XMLHttpRequest();
      		http_request.open("GET", request.url, true);
      		http_request.onreadystatechange = function() {
      			if (http_request.readyState == 4 && http_request.status == 200)
      				sendResponse({text: http_request.responseText});
      		};
      		http_request.send(null);
      		break;

   		case "newSession":
      		sessionID = "";
      		break;
                  
      	case "validate":
                  sendResponse( validate(request.artist, request.track) );
                  break;
		}
		
	}
);

/**
 * A tab has been reloaded, scrobble track if it was the nowPlayingTab
 */  
chrome.tabs.onUpdated.addListener(function(tabID, changeInfo, tab) {
	if (tabID == nowPlayingTab)
		if (changeInfo.url) 
               ;//submit();
});

/**
 * A tab has been removed, scrobble track if it was the nowPlayingTab
 */ 
chrome.tabs.onRemoved.addListener(function(tabID) {
	if (tabID == nowPlayingTab) 
         ;//submit();
});

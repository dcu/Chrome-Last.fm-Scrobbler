default:
	rm -f Chrome-Last.fm-Scrobbler.pem Chrome-Last.fm-Scrobbler.crx
	chromium-browser --enable-apps --pack-extension=../Chrome-Last.fm-Scrobbler
	mv ../Chrome-Last.fm-Scrobbler.crx ../Chrome-Last.fm-Scrobbler.pem .

console.log('titta klart')
const VERSION = '1.0.0';
let isNotified = false;
Sentry.init({
    dsn: 'https://119e710167b34a6a877b58ad0610f6f7@sentry.io/1381535'
});
Sentry.configureScope((scope) => {
    scope.setTag("version", VERSION);
});

function notify(message){
    if(typeof browser !== 'undefined') {
        browser.runtime.sendMessage({'daysLeft': message});
        isNotified = true

    } else if(typeof chrome !== 'undefined'){
        chrome.runtime.sendMessage({'daysLeft': message});
        isNotified = true
    } else {
        Sentry.captureMessage('Unable to send message to background script');
    }
}

function postData(url = '', data = {}) {
    return fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
    }).then(res => res.json());
}

async function getEpisodeByUrl(url){
    return postData('https://titta-klart-api.now.sh', {urls: [url]})
        .then((data) => getEpisode(data[url]))
        .catch(error => console.error(error));
}

async function getEpisode(id){
    return fetch('https://api.svt.se/videoplayer-api/video/' + id)
        .then(res => res.json())
        .then(json => {
            const { rights: { validTo }, episodeTitle, programTitle } = json;
            return {
                validTo,
                episodeTitle,
                programTitle
            }
        })
        .catch(err => {
            console.log(err)
        })
}

async function getNextEpisode(currentEpisodeUrl, episodeEls){
    const currentEpisodeUrlCleaned = currentEpisodeUrl
        .replace(location.search, '')
        .replace(location.hash, '');

    const currentEpisodeIndex = Array.prototype.slice.call(episodeEls).findIndex(episodeEl => {
        const href = episodeEl.getElementsByTagName('a')[0].href;

        return href.indexOf(currentEpisodeUrlCleaned) > -1;
    });

    if(currentEpisodeIndex > -1){
        const nextEpisodeEl = episodeEls[currentEpisodeIndex + 1];
        if(nextEpisodeEl){
            return getEpisodeByUrl(nextEpisodeEl.getElementsByTagName('a')[0].href)
        }
    }

    return Promise.resolve({});
}

async function checkTempo(){
    isNotified = false;
    const numberOfSlashesInUrl = (location.href.match(/\//g) || []).length;
    const numberOfVideoAndSlashesInUrl = (location.href.match(/\/video\//g) || []).length;

    //Is video page
    if(numberOfVideoAndSlashesInUrl === 1 && numberOfSlashesInUrl === 6) {
        const videoEl = document.querySelectorAll('[data-video-id]')[0];
        const seasonEpisodesEls = document.querySelectorAll('[id^="section-sasong"] li');
        const episodeEls =  seasonEpisodesEls.length ? seasonEpisodesEls : document.querySelectorAll('[class^="play_related-list lp_"] li');
        const numberOfEpisodes = episodeEls.length;
        const numberOfEpisodesWatched =
            document.querySelectorAll('[id^="section-sasong"] span[aria-valuenow|="100"]').length ||
            document.querySelectorAll('[class^="play_related-list lp_"] span[aria-valuenow|="100"]').length;

        //There is a video and additional content to watch
        if(videoEl && numberOfEpisodes > 0){
            const lastEpisodeEl = episodeEls[episodeEls.length - 1];
            const {validTo, episodeTitle, programTitle} = await getEpisode(videoEl.attributes['data-video-id'].value);
            const numberOfEpisodesLeft = numberOfEpisodes - numberOfEpisodesWatched;
            const title = programTitle + ' - ' + episodeTitle;

            if(validTo){
                const {validTo: lastEpisodeValidToDate} = await getEpisodeByUrl(lastEpisodeEl.getElementsByTagName('a')[0].href);

                //This video and the last one of the seaons got the same valid to date so we assume all videos got the same date
                if(validTo === lastEpisodeValidToDate.validTo){
                    let message = '';
                    const daysLeft = moment(validTo).diff(moment(), 'days');

                    if(daysLeft > numberOfEpisodesLeft){
                        message = `Du behöver se ett avsnitt var ${Math.floor(daysLeft/numberOfEpisodesLeft)} dag för att hinna se klart säsongen av ${title}`;

                    } else {
                        const numberOfEpisodesPerDay = daysLeft === 0 ? numberOfEpisodesLeft : numberOfEpisodesLeft/daysLeft;
                        message = `Du behöver se minst ${numberOfEpisodesPerDay} avsnitt varje dag för att hinna se klart säsongen av ${title}`;
                    }
                    notify(message);
                } else {
                    //TODO handle different valid to dates (calendar ics, notify end of video, browser push)

                    const { validTo, episodeTitle, programTitle } = await getNextEpisode(location.href, episodeEls);

                    if(validTo && episodeTitle && programTitle){
                        const daysLeft = moment(validTo).diff(moment(), 'days');
                        const message = `Nästa avsnitt finns kvar i ${daysLeft} dag(ar) och heter ${programTitle} - ${episodeTitle}`;
                        console.log(message);

                        videoEl.addEventListener("timeupdate", () => {
                            if(!isNotified && videoEl.duration - videoEl.currentTime < 60){
                                notify(message);
                            }
                        }, true);
                    } else {
                        console.log('No more episodes in list')
                    }

                }
            } else {
                const error = `validTo date "${validTo}" is missing`;
                Sentry.captureMessage(error);
                console.error(error);
            }
        } else {
            const error = 'Unable to calculate tempo';
            Sentry.captureMessage(error);
            console.error(error);
        }
    }
}

new MutationObserver(function() {
    setTimeout(function(){
        checkTempo();
    }, 2000)
}).observe(document.querySelector('title'), { childList: true });

checkTempo()
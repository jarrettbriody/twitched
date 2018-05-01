//Jarrett Briody
//Project 3
//server.js file

"use strict";

var querystring = require('querystring');
var http = require("http");
var https = require("https");
var fs = require('fs');
var url = require('url');
var util = require('util');
var WebSocket = require('ws');
var parseXML = require('xml2js').parseString;

var port = process.env.PORT || process.env.NODE_PORT || 3000;

var index = fs.readFileSync(__dirname + "/../client/index.html");
var xImg = fs.readFileSync(__dirname + "/../client/media/xImg.png");
var twitchyTV = fs.readFileSync(__dirname + "/../client/fonts/TwitchyTV.otf");

var channelJSON = undefined;

var badWordsList = undefined;

//keys and auth for twitch
var CLIENT_ID = "rqmzaob02j7xgmxu8hmj27hh19302q";
var CLIENT_SECRET = "yletu5kuelihpt8z0oyhhhv5pp5sd0";
var oAuthURL = `https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`;
var accessToken = "tnps4c3v94yp4p9oor6yowkkk2aa0t";

var cc = [];

var banFilters = {};

getFilter();

//request standard online ban filter
var xmlReq = http.request("http://www.bannedwordlist.com/lists/swearWords.xml", function(response){
    response.setEncoding('utf8');
    response.on('data', function(chunk) {
        parseXML(chunk, function (err, result) {
            badWordsList = result;
        });
    });
});
xmlReq.end();

//on a request sent to the server
var onRequest = function(request,response){
    var parsedUrl = url.parse(request.url);
    var params = querystring.parse(parsedUrl.query);
    
    var headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json"
    };
    
    //if a new twitch user is being requested
    if(parsedUrl.pathname === "/user") {
        requestTwitchUser([params.name],"users", function(chunk){
            var json = JSON.parse(chunk);
            response.writeHead(200,headers);
            response.write(JSON.stringify(chunk));
            response.end();

            //check if there is already a websocket for the requested user, client might change from just chat to stream and chat
            var exists = false;
            for(var i = 0; i < cc.length; i++){
                if(cc[i].channel === json.data[0].login){
                    exists = true;
                    break;
                }
            }
            if(json.data.length > 0 && !exists){
                var newCC = new CC("twitched_bot", accessToken, json.data[0].login);
                cc.push(newCC);
                newCC.open();
            }
        }, response, headers);
    }

    //if a websocket is being canceled
    else if(parsedUrl.pathname === "/cancel") {
        for(var i = 0; i < cc.length; i++){
            if(params.name == cc[i].channel){
                cc[i].close();
                cc.splice(i,1);
                break;
            }
        }
        response.writeHead(200,headers);
        response.write(JSON.stringify({"status":"success"}));
        response.end();
    }

    //if an image is being requested, only used for ximg
    else if(parsedUrl.pathname.includes("/media")){
        if(parsedUrl.pathname.includes("/xImg")){
            //console.log("should be sending image");
            headers["Content-Type"] = "image/png";
            response.writeHead(200,headers);
            response.write(xImg, 'base64');
            response.end();
        }
    }

    //if a font is being requested, only used for twitchy
    else if(parsedUrl.pathname.includes("/fonts")){
        if(parsedUrl.pathname.includes("/TwitchyTV")){
            headers["Content-Type"] = "font/opentype";
            response.writeHead(200,headers);
            response.write(twitchyTV);
            response.end();
        }
    }

    //default page being sent
    else {
        headers["Content-Type"] = "text/html";
        response.writeHead(200,headers);// {"Content-Type":"text/html"}
        response.write(index);
        response.end();
    }
};

//request twitch for an oauth token, unused, does work however
function requestServerAccessToken(){
    var options = {
        protocol: "https:",
        hostname: 'id.twitch.tv',
        path: `/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials&scope=channel_feed_read`,
        method: 'POST'
    };
    var twitchRequest = https.request(options, function(twitchResponse){
        twitchResponse.setEncoding('utf8');
        twitchResponse.on('data', function(chunk) {
            var json = JSON.parse(chunk);
            accessToken = json.access_token;
            //console.log("Access Token:", accessToken);
        });
    });
    twitchRequest.on('error', function(e){
        console.error(`OAuth2 Problem: ${e.message}`);
    });
    twitchRequest.end();
}

//request some twitch user from twitch api, allows for different types of data to be retrieved
function requestTwitchUser(username,path, callback, response, returnHeaders){
    var options = {
        protocol: "https:",
        hostname: 'api.twitch.tv',
        path: '/helix/users?login=' + username[0],
        method: 'GET',
        headers: {
            "Accept": "application/vnd.twitchtv.v5+json",
            "Client-ID": CLIENT_ID,
            "Authorization": "Bearer " + accessToken,
            "Content-Type": "application/json"
        }
    };
    switch(path){
        case "users":
            options.path = '/helix/users?login=' + username[0];
            break;
        case "follows":
            options.path = "/helix/users/follows?from_id=" + username[0] + "&to_id=" + username[1];
            break;
        default:
            break;
    }
    //send it, call callback on finish
    var twitchRequest = https.request(options, function(twitchResponse){
        twitchResponse.setEncoding('utf8');
        twitchResponse.on('data', function(chunk) {
            var json = JSON.parse(chunk);
            if(callback) {
                callback(chunk);
            }
            return json;
        });
    });
    //if the twitch request fails then fail the user
    twitchRequest.on('error', function(e){
        console.error(`problem with request: ${e.message}`);
        if(response && returnHeaders){
            response.writeHead(404,returnHeaders);
            response.write(JSON.stringify({"error": "Invalid request"}));
            response.end();
        }
    });

    twitchRequest.end();
}

//request op.gg for an html page to parse and produce values, this is a terrible practice and i go into it more in detail in the documentation
function requestOPGG(username,path, callback){
    var userarray = username.split(' ');
    username = userarray.join("+").toLowerCase();
    var options = {
        protocol: "http:",
        hostname: 'na.op.gg',
        path: '/summoner/userName=' + username,
        method: 'GET',
        headers: {
            "Accept": "text/html",
            "Accept-Charset": "utf8",
            "Content-Type": "text/html"
        }
    };
    switch(path){
        case "champions":
            options.path = '/summoner/champions/userName=' + username;
            break;
        default:
            break;
    }
    
    //send the request, call the callback
    var opggRequest = http.request(options, function(opggResponse){
        opggResponse.setEncoding('utf8');
        var chunks = [];
        opggResponse.on('data', function(chunk) {
            chunks.push(chunk);
        });
        opggResponse.on('end', function() {
            var fullString = chunks.join('');
            if(callback) {
                callback(fullString);
            }
        });
    });
    opggRequest.on('error', function(e){
        console.error(`problem with request: ${e.message}`);
    });

    opggRequest.end();
}

//chat channel class for irc websocket
function CC(username,password,channel){
    this.username = username;
    this.password = password;
    this.channel = channel;
    this.wordBank = new Map();
    this.isMod = false;
}

//when the channel is opened, create a new websocket and link up functions
CC.prototype.open = function(){
    this.ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443/", "irc");//"wss://irc-ws.chat.twitch.tv:443/", "irc"
    this.ws.onmessage = this.onMessage.bind(this);
    this.ws.onerror = this.onError.bind(this);
    this.ws.onclose = this.onClose.bind(this);
    this.ws.onopen = this.onOpen.bind(this);
};

//close the websocket
CC.prototype.close = function(){
    if(this.ws){
        this.ws.close();
    }
};

//on error, print the error
CC.prototype.onError = function(message){
    console.log('Error: ' + message);
};

//on open, ensure the websocket exists and is ready to being sending
CC.prototype.onOpen = function(){
    if (this.ws !== null && this.ws.readyState === 1) {
        console.log("Connecting...");
        this.ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership');
        this.ws.send('PASS ' + "oauth:" + this.password);
        this.ws.send('NICK ' + this.username);
        this.ws.send('JOIN ' + "#" + this.channel);
        console.log("Connected.");
    }
};

//on close, log it to the console
CC.prototype.onClose = function(){
    console.log('Disconnected from the chat server.');
};

//when a message is received in whatever relevant web socket, determine what command was sent from twitch, do things that are never used
CC.prototype.onMessage = function(message){
    if(message !== null){
        var parsed = this.parseMessage(message.data);
        if(parsed !== null){
            if(parsed.command === "PRIVMSG") {
                for(var i = 0; i < parsed.words.length; i++){
                    if(this.wordBank.has(parsed.words[i])){
                        var num = this.wordBank.get(parsed.words[i]);
                        num++;
                        this.wordBank.set(parsed.words[i],num);
                    }
                    else this.wordBank.set(parsed.words[i],1);
                }
                if(this.wordBank.size > 100){
                    var numToRemove = this.wordBank.size - 100;
                    var iterator = this.wordBank.keys();
                    for(var i = 0; i < numToRemove; i++){
                        var key = iterator.next().value;
                        this.wordBank.delete(key);
                    }
                }
            } 
            else if(parsed.command === "PING") {
                this.ws.send("PONG :" + parsed.words[0]);
            }
        }
    }
};

//where the magic happens, parse some users message
CC.prototype.parseMessage = function(rawMessage) {
    //return values for later
    var message = {
        name: undefined,
        command:undefined,
        words:[]
    };
    //if its a message 
    if(rawMessage[0] === '@'){
        var splitMessage = rawMessage.split(' ');
        //get the name of the user who sent it
        if(splitMessage[1]){
            message.name = splitMessage[1].substring(1,splitMessage[1].indexOf("!"));
        }
        //check to see if the message was one of the initial pings sent by the bot, if it was and the bot is a mod in the channel it is in, then allow it permission to try to ban people
        if(splitMessage[0] && !this.isMod){
            if(splitMessage[0].substring(splitMessage[0].indexOf("=",splitMessage[0].indexOf("badges")) + 1, splitMessage[0].indexOf(";")).includes("moderator") && splitMessage[0].includes("display-name=twitched_bot")){
                this.isMod = true;
            }
        }
        //set the command of the message, only PRIVMSG or PING matter to me
        if(splitMessage[2]){
            message.command = splitMessage[2];
        }
        //if the command was a private message
        if(splitMessage[2] == "PRIVMSG"){
            //this is all arbitrary string parsing
            var w = rawMessage.substring(rawMessage.indexOf(":",rawMessage.indexOf("PRIVMSG")) + 1);
            var wordArray = [];
            w = w.replace(/\r?\n|\r/, "");
            //if someone typed a command
            if(w[0] == "!"){
                var command;
                if(w.includes(" ")) command = w.substring(1,w.indexOf(' ')).toLowerCase();
                else command = w.substring(1);
                
                //if the command is filter, add whatever the following string is to the ban filter
                if(command == "filter"){ //&& splitMessage[0].substring(splitMessage[0].indexOf("=",splitMessage[0].indexOf("badges")) + 1, splitMessage[0].indexOf(";")).includes("moderator") && this.username == "twitched_bot"
                    var banWord = w.substring(w.indexOf(' ') + 1);
                    if(banWord.replace(' ', '') != ''){
                        getFilter(banWord.toLowerCase(), this.channel);
                        this.ws.send(`PRIVMSG #${this.channel} :@${message.name} \"${banWord}\" has been added to the ban list.\r\n`);
                    }
                }

                //if the command is clearfilter, empty the entire ban filter
                else if(command == "clearfilter"){
                    getFilter(null, this.channel, false);
                    this.ws.send(`PRIVMSG #${this.channel} :@${message.name} Filter has been cleared.\r\n`);
                }

                //if the command is unfilter, remove whatever the following string is from the ban filter
                else if(command == "unfilter"){
                    var banWord = w.substring(w.indexOf(' ') + 1);
                    getFilter(banWord.toLowerCase(), this.channel, false);
                    this.ws.send(`PRIVMSG #${this.channel} :@${message.name} \"${banWord}\" has been removed from the ban list.\r\n`);
                }

                //if the command is roll, roll a random number between 1 and whatever the number is they sent following the command
                else if(command == "roll"){
                    var num = w.substring(w.indexOf(' ') + 1);
                    num = parseInt(num);
                    var randNum = Math.floor(Math.random() * num + 1);
                    this.ws.send(`PRIVMSG #${this.channel} :@${message.name} ${randNum} was the result of your roll.\r\n`);
                }

                //%%% WARNING: ABSOLUTE CANCER FOLLOWING THIS POINT %%%
                //         SEE DOCUMENTATION FOR EXPLANATION

                //if the command is lol, check what the subcommand is
                else if(command == "lol"){
                    var splitCommand = w.split(" ", 2);
                    if(splitCommand[1]){
                        var leagueUser = w.substring(w.indexOf(" ",w.indexOf(splitCommand[1])) + 1);

                        //if the command is rank, check the rank of the user sent in the following string
                        if(splitCommand[1] === "rank"){
                            requestOPGG(leagueUser,"users", (function(htmlString){
                                var loc = htmlString.indexOf("class=\"tierRank\"");
                                if(loc != -1){
                                    var rank = htmlString.substring(htmlString.indexOf(">",loc) + 1, htmlString.indexOf("<",loc));
                                    this.ws.send(`PRIVMSG #${this.channel} :@${message.name} Summoner \"${leagueUser}\" is ${rank}.\r\n`);
                                }
                                else{
                                    this.ws.send(`PRIVMSG #${this.channel} :@${message.name} Summoner \"${leagueUser}\" does not exist.\r\n`);
                                }
                            }).bind(this));
                        }

                        //if the command is level, check the level of the user sent in the following string
                        else if(splitCommand[1] === "level"){
                            requestOPGG(leagueUser,"users", (function(htmlString){
                                var loc = htmlString.indexOf('class="Level tip"');
                                if(loc != -1){
                                    var level = htmlString.substring(htmlString.indexOf(">",loc) + 1, htmlString.indexOf("<",loc));
                                    this.ws.send(`PRIVMSG #${this.channel} :@${message.name} Summoner \"${leagueUser}\" is level ${level}.\r\n`);
                                }
                                else{
                                    this.ws.send(`PRIVMSG #${this.channel} :@${message.name} Summoner \"${leagueUser}\" does not exist.\r\n`);
                                }
                            }).bind(this));
                        }
                        
                        //if the command is main, check the primary champion of the user sent in the following string
                        else if(splitCommand[1] === "main"){
                            requestOPGG(leagueUser,"champions", (function(htmlString){
                                var loc = htmlString.indexOf("class=\"ChampionName Cell\"");
                                loc = htmlString.indexOf('data-value="', loc) + 'data-value="'.length;
                                if(loc != -1){
                                    var main = htmlString.substring(loc, htmlString.indexOf("\"",loc));
                                    this.ws.send(`PRIVMSG #${this.channel} :@${message.name} Summoner \"${leagueUser}\" currently mains ${main}.\r\n`);
                                }
                                else{
                                    this.ws.send(`PRIVMSG #${this.channel} :@${message.name} Summoner \"${leagueUser}\" does not exist or does not have a main champion.\r\n`);
                                }
                            }).bind(this));
                        }

                        //if the command is winratio, check the win ratio of the user sent in the following string
                        else if(splitCommand[1] === "winratio"){
                            requestOPGG(leagueUser,"users", (function(htmlString){
                                var loc = htmlString.indexOf('class="winratio"');
                                if(loc != -1){
                                    var ratio = htmlString.substring(htmlString.indexOf(">",loc) + 1, htmlString.indexOf("<",loc));
                                    ratio = ratio.replace("Win Ratio ", "");
                                    this.ws.send(`PRIVMSG #${this.channel} :@${message.name} Summoner \"${leagueUser}\" has a ${ratio} win rate.\r\n`);
                                }
                                else {
                                    var loc = htmlString.indexOf('class="WinRatioTitle"');
                                    if(loc != -1){
                                        var loc2 = htmlString.indexOf('</div>', loc);
                                        var substringOfHTML = htmlString.substring(loc,loc2);
                                        var posInit = substringOfHTML.indexOf(">",substringOfHTML.indexOf('class="total"'));
                                        var totalGames = substringOfHTML.substring(posInit + 1, substringOfHTML.indexOf("<",posInit));
                                        posInit = substringOfHTML.indexOf(">",substringOfHTML.indexOf('class="win"'));
                                        var wonGames = substringOfHTML.substring(posInit + 1, substringOfHTML.indexOf("<",posInit));
                                        var ratio = Math.round((wonGames / totalGames) * 100);
                                        this.ws.send(`PRIVMSG #${this.channel} :@${message.name} Summoner \"${leagueUser}\" has a ${ratio}% win rate.\r\n`);
                                    }
                                    else{
                                        this.ws.send(`PRIVMSG #${this.channel} :@${message.name} Summoner \"${leagueUser}\" does not exist.\r\n`);
                                    }
                                }
                            }).bind(this));
                        }
                    }
                }

                //if the command is followage, check the followage from the user who sent the request to the user provided in the following string
                //there are much better ways to code this, should have had it so first two callbacks execute simultaneously and checked for each other on completion
                else if(command == "followage"){
                    //request the twitch id of the user who sent the command
                    var following = w.substring(w.indexOf(' ') + 1);
                    requestTwitchUser([message.name], "users", (function(fromChunk){
                        var fromData = JSON.parse(fromChunk);
                        //request the twitch id of the user who the command was directed at
                        requestTwitchUser([following], "users", (function(toChunk){
                            var toData = JSON.parse(toChunk);
                            //request twitch to see if user 1 is following user 2 and for how long
                            requestTwitchUser([fromData.data[0].id, toData.data[0].id], "follows", (function(finalChunk){
                                var finalData = JSON.parse(finalChunk);
                                if(finalData.data.length == 1){
                                    var followDate = new Date(finalData.data[0].followed_at);
                                    followDate = followDate.getTime();
                                    var currentDate = Date.now();
                                    var elapsed = currentDate - followDate;
                                    elapsed /= 1000;
                                    var days = Math.floor((elapsed / 86400));
                                    this.ws.send(`PRIVMSG #${this.channel} :@${message.name} You have been following \"${following}\" for ${days} days!\r\n`);
                                }
                                else{
                                    this.ws.send(`PRIVMSG #${this.channel} :@${message.name} You are not following ${following}!\r\n`);
                                }
                            }).bind(this));
                        }).bind(this));
                    }).bind(this));
                }
            }

            //if the user did not send a command
            else{
                wordArray = w.split(' ');
                for(var i = 0; i < wordArray.length; i++){
                    message.words.push(wordArray[i]);
                }
                if(this.checkBanList(w) && this.isMod){
                    this.ws.send(`PRIVMSG #${this.channel} :/timeout ${message.name} 10`);
                    this.ws.send(`PRIVMSG #${this.channel} :/w ${message.name} You have been timed out for 10 seconds for profanity.\r\n`)
                }
            }
        }
    } 
    //if its a ping from twitch to check up on you and make sure youre not dead
    else if(rawMessage.startsWith("PING")) {
        message.command = "PING";
        message.words.push(rawMessage.split(":")[1]);
    }
    return message;
}

//checks the ban list correlating with the channel currently being moderated, as well as the global filter
CC.prototype.checkBanList = function(someMessageString){
    var words = someMessageString.split(' ');
    //first check if the whole string is a banned word
    if(banFilters[this.channel]){
        if(banFilters[this.channel].includes(someMessageString.toLowerCase())) return true;
    }
    //then check for each word in the string if it is banned against the online banned word list and the local one
    for(var i = 0; i < words.length; i++){
        var word = words[i];
        if(badWordsList.words.word.includes(word.toLowerCase())){
            return true;
        }
        if(banFilters[this.channel]){
            if(banFilters[this.channel].includes(word.toLowerCase())){
                return true;
            }
        }
    }
    return false;
}

//helper for writing to the console
function cw(arg){
    console.log(util.inspect(arg, false, 100, true));
}

//gets or updates a ban filter for a certain channel
function getFilter(newWord = undefined, channel = undefined, isAdding = true){
    //check if the file exists
    fs.exists("filter.json", function(isExists){
        if(isExists){
            fs.readFile("filter.json", "utf8", function(err,data){
                if(!err){
                    //read the file into json
                    var json = JSON.parse(data);
                    //if a channel is provided, always does
                    if(channel != undefined){
                        //add a word to the channel
                        if(isAdding && newWord != undefined){
                            if(json[channel]){
                                if(!json[channel].includes(newWord)) json[channel].push(newWord);
                            }
                            else json[channel] = [newWord];
                        }
                        else{
                            //clear the filter
                            if(newWord == undefined){
                                json[channel] = [];
                            }
                            //remove the word from the filter of the channel
                            else{
                                if(json[channel]){
                                    if(json[channel].includes(newWord)) json[channel].splice(json[channel].indexOf(newWord), 1);
                                }
                            }
                        }
                        //write it
                        banFilters = json;
                        fs.writeFile("filter.json", JSON.stringify(json), "utf8", function(){});
                    }
                }
            });
        }
        //if the file does not exist
        else{
            var filters = {};
            if(channel != undefined){
                if(newWord == undefined && !isAdding) filters[channel] = []; //clear was used on a channel not already present in ban filter, just make it empty array
                else filters[channel] = [newWord]; //make a new array with the first requested filter word
            } 
            //write it
            banFilters = filters;
            fs.writeFile("filter.json", JSON.stringify(filters), "utf8", function(){});
        }
    });
}

http.createServer(onRequest).listen(port);

console.log("Listening on localhost:" + port);

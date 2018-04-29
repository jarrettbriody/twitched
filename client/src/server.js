var querystring = require('querystring');
var http = require("http");
var https = require("https");
var fs = require('fs');
var url = require('url');
var util = require('util');
var WebSocket = require('ws');

var port = process.env.PORT || process.env.NODE_PORT || 3000;

var index = fs.readFileSync(__dirname + "/../client/index.html");

var channelJSON = undefined;

var CLIENT_REDIRECT = "https://twitchedapp.herokuapp.com";
//var USER_AUTH = undefined;
var CLIENT_ID = "rqmzaob02j7xgmxu8hmj27hh19302q";
var CLIENT_SECRET = "yletu5kuelihpt8z0oyhhhv5pp5sd0";
var oAuthURL = `https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`;
var accessToken = "mqb63hqjbps908xfmp2xge9gc55c0j";
//requestServerAccessToken();

var cc = undefined;

var onRequest = function(request,response){
    var parsedUrl = url.parse(request.url);
    var params = querystring.parse(parsedUrl.query);
    console.log(request.url);
    
    var headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json"
    };
    
    if(parsedUrl.pathname === "/user") {
        requestTwitchUser(response, params, headers);
    }
    /*
    else if(parsedUrl.pathname === "/palette"){
        requestPictaculous(response, params, )
    }
    */
    else {
        headers["Content-Type"] = "text/html";
        response.writeHead(200,headers);// {"Content-Type":"text/html"}
        response.write(index);
        response.end();
    }
};

function requestServerAccessToken(){
    var options = {
        protocol: "https:",
        hostname: 'id.twitch.tv',
        path: `/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials&scope=channel_feed_read`,
        method: 'POST'
    };
    
    var twitchRequest = https.request(options, (twitchResponse) => {
        twitchResponse.setEncoding('utf8');
        twitchResponse.on('data', function(chunk) {
            var json = JSON.parse(chunk);
            accessToken = json.access_token;
            console.log("Access Token:", accessToken);
        });
    });
    
    twitchRequest.on('error', (e) => {
        console.error(`OAuth2 Problem: ${e.message}`);
    });

    twitchRequest.end();
}

function requestTwitchUser(response, params, returnHeader){
    var options = {
        protocol: "https:",
        hostname: 'api.twitch.tv',
        path: '/kraken/users?login=' + params.name,
        method: 'GET',
        headers: {
            "Accept": "application/vnd.twitchtv.v5+json",
            "Client-ID": CLIENT_ID,
            "Authorization": "Bearer " + accessToken
        }
    };
    
    var twitchRequest = https.request(options, (twitchResponse) => {
        twitchResponse.setEncoding('utf8');
        
        twitchResponse.on('data', function(chunk) {
            channelJSON = JSON.parse(chunk);
            response.writeHead(200,returnHeader);
            //var colors = requestPictaculous(channelJSON.users[0].logo);
            //channelJSON.profileColors = colors;
            response.write(JSON.stringify(chunk));
            response.end();
            if(cc){
                cc.close();
            }
            
            if(channelJSON._total > 0){
                cc = new CC("jarrettbriody", accessToken, channelJSON.users[0].name);
                cc.open();
            }
        });
    });
    
    twitchRequest.on('error', (e) => {
        console.error(`problem with request: ${e.message}`);
        response.writeHead(404,returnHeader);
        response.end();
    });

    twitchRequest.end();
}

function CC(username,password,channel){
    this.username = username;
    this.password = password;
    this.channel = channel;
    this.wordBank = new Map();
}

CC.prototype.open = function(){
    this.ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443/", "irc");//"wss://irc-ws.chat.twitch.tv:443/", "irc"
    this.ws.onmessage = this.onMessage.bind(this);
    this.ws.onerror = this.onError.bind(this);
    this.ws.onclose = this.onClose.bind(this);
    this.ws.onopen = this.onOpen.bind(this);
};

CC.prototype.close = function(){
    if(this.ws){
        this.ws.close();
    }
};

CC.prototype.onError = function(message){
    console.log('Error: ' + message);
};

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

CC.prototype.onClose = function(){
    console.log('Disconnected from the chat server.');
};

CC.prototype.onMessage = function(message){
    if(message !== null){
        var parsed = this.parseMessage(message.data);
        if(parsed !== null){
            if(parsed.command === "PRIVMSG") {
                for(var i = 0; i < parsed.words.length; i++){
                    if(cc.wordBank.has(parsed.words[i])){
                        var num = cc.wordBank.get(parsed.words[i]);
                        num++;
                        cc.wordBank.set(parsed.words[i],num);
                    }
                    else cc.wordBank.set(parsed.words[i],1);
                }
                if(cc.wordBank.size > 100){
                    var numToRemove = cc.wordBank.size - 100;
                    var iterator = cc.wordBank.keys();
                    for(var i = 0; i < numToRemove; i++){
                        var key = iterator.next().value;
                        cc.wordBank.delete(key);
                    }
                }
            } 
            else if(parsed.command === "PING") {
                this.ws.send("PONG :" + parsed.words[0]);
            }
        }
    }
};

CC.prototype.parseMessage = function(rawMessage) {
    var message = {
        words:[],
        command:undefined
    };
    if(rawMessage[0] === '@'){
        var cutString = rawMessage.substring(rawMessage.indexOf(" ",rawMessage.indexOf("tmi.twitch.tv")) + 1);
        var splitArray = cutString.split(' ', 2);
        splitArray.push(cutString.substring(cutString.indexOf(":") + 1));
        message.command = splitArray[0];
        var wordArray = [];
        if(splitArray[2]){
            splitArray[2] = splitArray[2].replace(/\r?\n|\r/, "");
            console.dir(splitArray[2]);
            wordArray = splitArray[2].split(' ');
            for(var i = 0; i < wordArray.length; i++){
                message.words.push(wordArray[i]);
            }
        } 
    } 
    else if(rawMessage.startsWith("PING")) {
        message.command = "PING";
        message.words.push(rawMessage.split(":")[1]);
    }
    return message;
}

function cw(arg){
    console.log(util.inspect(arg, false, 100, true));
}

http.createServer(onRequest).listen(port);

console.log("Listening on localhost:" + port);

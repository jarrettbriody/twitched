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

var channelJSON = undefined;

var badWordsList = undefined;

//var CLIENT_REDIRECT = "https://twitchedapp.herokuapp.com";
//var USER_AUTH = undefined;
var CLIENT_ID = "rqmzaob02j7xgmxu8hmj27hh19302q";
var CLIENT_SECRET = "yletu5kuelihpt8z0oyhhhv5pp5sd0";
var oAuthURL = `https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`;
var accessToken = "tnps4c3v94yp4p9oor6yowkkk2aa0t";
//requestServerAccessToken();

var cc = [];

var banFilters = {};

getFilter();

var xmlReq = http.request("http://www.bannedwordlist.com/lists/swearWords.xml", function(response){
    response.setEncoding('utf8');
    
    response.on('data', function(chunk) {
        parseXML(chunk, function (err, result) {
            badWordsList = result;
        });
    });
});
xmlReq.end();

var onRequest = function(request,response){
    var parsedUrl = url.parse(request.url);
    var params = querystring.parse(parsedUrl.query);
    console.log(request.url);
    //console.dir(parsedUrl);
    
    var headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json"
    };
    
    if(parsedUrl.pathname === "/user") {
        requestTwitchUser([params.name],"users", function(chunk){
            var json = JSON.parse(chunk);
            response.writeHead(200,headers);
            response.write(JSON.stringify(chunk));
            response.end();
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
        });
    }

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

    else if(parsedUrl.pathname.includes("/media")){
        if(parsedUrl.pathname.includes("/xImg")){
            //console.log("should be sending image");
            headers["Content-Type"] = "image/png";
            response.writeHead(200,headers);
            response.write(xImg, 'base64');
            response.end();
        }
    }

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
    
    var twitchRequest = https.request(options, function(twitchResponse){
        twitchResponse.setEncoding('utf8');
        twitchResponse.on('data', function(chunk) {
            var json = JSON.parse(chunk);
            accessToken = json.access_token;
            console.log("Access Token:", accessToken);
        });
    });
    
    twitchRequest.on('error', function(e){
        console.error(`OAuth2 Problem: ${e.message}`);
    });

    twitchRequest.end();
}

function requestTwitchUser(username,path, callback){
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
    
    twitchRequest.on('error', function(e){
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
    this.isMod = false;
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

CC.prototype.parseMessage = function(rawMessage) {
    var message = {
        name: undefined,
        command:undefined,
        words:[]
    };
    if(rawMessage[0] === '@'){
        //rawMessage.replace("@", "");
        //console.dir(rawMessage);
        var splitMessage = rawMessage.split(' ');
        //if(splitMessage[0]) console.dir(splitMessage[0]);
        if(splitMessage[1]){
            message.name = splitMessage[1].substring(1,splitMessage[1].indexOf("!"));
            //console.dir(message.name);
        }
        if(splitMessage[0] && !this.isMod){
            if(splitMessage[0].substring(splitMessage[0].indexOf("=",splitMessage[0].indexOf("badges")) + 1, splitMessage[0].indexOf(";")).includes("moderator") && splitMessage[0].includes("display-name=twitched_bot")){
                this.isMod = true;
            }
        }
        if(splitMessage[2]){
            message.command = splitMessage[2];
            //console.dir(message.command);
        }
        if(splitMessage[2] == "PRIVMSG"){
            var w = rawMessage.substring(rawMessage.indexOf(":",rawMessage.indexOf("PRIVMSG")) + 1);
            var wordArray = [];
            w = w.replace(/\r?\n|\r/, "");
            //console.dir(w);
            if(w[0] == "!"){
                var command = w.substring(1,w.indexOf(' ')).toLowerCase();
                if(command == "filter"){ //&& splitMessage[0].substring(splitMessage[0].indexOf("=",splitMessage[0].indexOf("badges")) + 1, splitMessage[0].indexOf(";")).includes("moderator") && this.username == "twitched_bot"
                    var banWord = w.substring(w.indexOf(' ') + 1);
                    getFilter(banWord.toLowerCase(), this.channel);
                    this.ws.send(`PRIVMSG #${this.channel} :@${message.name} \"${banWord}\" has been added to the ban list.\r\n`);
                }
                else if(command == "roll"){
                    var num = w.substring(w.indexOf(' ') + 1);
                    num = parseInt(num);
                    var randNum = Math.floor(Math.random() * num + 1);
                    //console.dir(`PRIVMSG #${this.channel} :@${message.name} ${randNum} was the result of your roll.`);
                    this.ws.send(`PRIVMSG #${this.channel} :@${message.name} ${randNum} was the result of your roll.\r\n`);
                }
                else if(command == "followage"){
                    var following = w.substring(w.indexOf(' ') + 1);
                    requestTwitchUser([message.name], "users", (function(fromChunk){
                        //console.log("Requesting user who typed command");
                        var fromData = JSON.parse(fromChunk);
                        requestTwitchUser([following], "users", (function(toChunk){
                            //console.log("Requesting targeted user");
                            var toData = JSON.parse(toChunk);
                            requestTwitchUser([fromData.data[0].id, toData.data[0].id], "follows", (function(finalChunk){
                                //console.log("Requesting check for follow");
                                var finalData = JSON.parse(finalChunk);
                                if(finalData.data.length == 1){
                                    var followDate = new Date(finalData.data[0].followed_at);
                                    followDate = followDate.getTime();
                                    var currentDate = Date.now();
                                    var elapsed = currentDate - followDate;
                                    elapsed /= 1000;
                                    var days = Math.floor((elapsed / 86400));
                                    this.ws.send(`PRIVMSG #${this.channel} :@${message.name} You have been following ${following} for ${days} days!\r\n`);
                                }
                                else{
                                    this.ws.send(`PRIVMSG #${this.channel} :@${message.name} You are not following ${following}!\r\n`);
                                }
                            }).bind(this));
                        }).bind(this));
                    }).bind(this));
                }
            }
            else{
                wordArray = w.split(' ');
                for(var i = 0; i < wordArray.length; i++){
                    message.words.push(wordArray[i]);
                }
                if(this.checkBanList(w) && this.isMod){
                    console.log("banning " + message.name);
                    this.ws.send(`PRIVMSG #${this.channel} :/timeout ${message.name} 10`);
                    this.ws.send(`PRIVMSG #${this.channel} :/w ${message.name} You have been timed out for 10 seconds for profanity.\r\n`)
                }
            }
        }
    } 
    else if(rawMessage.startsWith("PING")) {
        message.command = "PING";
        message.words.push(rawMessage.split(":")[1]);
    }
    return message;
}

CC.prototype.checkBanList = function(someMessageString){
    var words = someMessageString.split(' ');
    if(banFilters[this.channel]){
        if(banFilters[this.channel].includes(someMessageString.toLowerCase())) return true;
    }
    for(var i = 0; i < words.length; i++){
        var word = words[i];
        if(badWordsList.words.word.includes(word.toLowerCase())){
            console.log("bad word: " + word);
            return true;
        }
        if(banFilters[this.channel]){
            if(banFilters[this.channel].includes(word.toLowerCase())){
                console.log("bad word: " + word);
                return true;
            }
        }
    }
    return false;
}

function cw(arg){
    console.log(util.inspect(arg, false, 100, true));
}

function getFilter(newWord = undefined, channel = undefined){
    fs.exists("filter.json", function(isExists){
        if(isExists){
            fs.readFile("filter.json", "utf8", function(err,data){
                if(!err){
                    var json = JSON.parse(data);
                    if(newWord != undefined && channel != undefined){
                        if(json[channel]){
                            if(!json[channel].includes(newWord)) json[channel].push(newWord);
                        } 
                        else json[channel] = [newWord];
                    } 
                    banFilters = json;
                    if(newWord != undefined && channel != undefined){
                        fs.writeFile("filter.json", JSON.stringify(json), "utf8", function(){
                            console.log("file write complete");
                        });
                    }
                }
            });
        }
        else{
            var filters = {};
            if(newWord != undefined && channel != undefined){
                filters[channel] = [newWord];
            } 
            banFilters = filters;
            fs.writeFile("filter.json", JSON.stringify(filters), "utf8", function(){
                console.log("new file write complete");
            });
        }
    });
}

http.createServer(onRequest).listen(port);

console.log("Listening on localhost:" + port);

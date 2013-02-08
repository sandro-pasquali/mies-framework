var config 			= require("./config.json");
var db_prefix		= config.db_prefix + ":";
var db_usertable	= db_prefix + "users";

var util		= require('util');
var https		= require('https');
var http		= require('http');
var fs 			= require('fs');
var express		= require('express');
var crypto		= require('crypto');
var uuid 		= require('node-uuid');

//	While a powerful and good DB, for mies the sqlite db is intended for data which does not  
//	change regularly, preferably data which never changes -- focus on reads, not writes.
//
var sqlite3		= require('sqlite3').verbose();
var db_local	= new sqlite3.Database('db/db');

//	The redis db is the main db for user accounts and call data storage.
//
var _redis	= require('redis');
var redis	= _redis.createClient(config.db_port, config.db_host, config.db_options);

var bauhaus		= require('bauhaus');
var amqp 		= require('amqp');

var clio	= require("clio")({
	version : "0.1",
    options : {
        "-port"  	: "The port this server will run on",
        "-host"		: "The host to listen on",
        "-protocol"	: "HTTP or HTTPS"
    }
}).parse();

process.on('uncaughtException', function(err) {
	clio.write("@white@_red Error thrown in server.js: @yellow@_black " + err + " @@`");
	process.exit(0);
});

var port 		= clio.get("-port") || "2112";
var host		= clio.get("-host") || "127.0.0.1";
var protocol	= clio.get("-protocol") || "http";

//	@see	#broadcast
//
var clientsById 	= {};
var sessionRequests = {};

var server;
var socketio;
var app;
var appget;

//////////////////////////////////////////////////////////////////////////////////
//																				//
//							MESSAGE QUEUE SETUP									//
//																				//
//////////////////////////////////////////////////////////////////////////////////

var conn_receive = amqp.createConnection({host: '127.0.0.1'});
var conn_publish;

conn_receive.on('ready', function() {
    conn_publish = amqp.createConnection({host: '127.0.0.1'});
    conn_publish.on('ready', function() {

		conn_receive.queue(config.reply_queue_name, {
			autoDelete: false
		}, function(queue){

        	queue.subscribe(function(msg, headers, corr) {

				var meta = msg.meta;
				delete msg.meta;

				var ord		= 0;
				var bytes	= tools.byteLength(JSON.stringify(msg));
				var client 	= clientsById[meta.sessionId];

				var callId	= corr.correlationId;

console.log(bytes);

				//	Without #meta information the response dies on the vine.
				//
				meta &&	redis.get(callId, function(err, val) {

					//	No longer exists. This is a timeout error... or worse.
					//
					if(val === null) {
						if(client) {
							client.send(callId, {
								error:  "failed"
							});
						}
						return;
					}

					//	The redis record MAY store a compile-able function, or
					//	return null.
					//
					//	There is a cost to fetching a function string, compiling it
					//	and executing it. You should do so sparingly. It should only be
					//	necessary when you want to do post-processing of a queue response
					//	prior to returning the processed result to the client.
					//
					//	Ideally, all this work will be performed by the service which
					//	returned data in the first place, avoiding the extra step.
					//
					if(client) {
						ENV.request = client.request;
						if(val && ((new Function("msg,send,env", val))(msg, function(m) {
								client.send(callId, m || msg);
							}, ENV) !== true)) {

							return;
						}
						delete ENV.request;
						client.send(callId, msg);
					}
				});
			});
    	});
	});
});

//////////////////////////////////////////////////////////////////////////////////
//																				//
//								Configure HTTPS server							//
//																				//
//////////////////////////////////////////////////////////////////////////////////

app = express();

app
//.use(express.compress())
.use(express.static('www'))
.use(express.bodyParser());

appget = app.get

app.get = function(path) {
	if(path.charAt(path.length -1) !== "/") {
		path += "/"
	}

	path += ":remote?";

	return appget.apply(app,  [].slice.call(arguments));
}

//////////////////////////////////////////////////////////////////////////////////
//																				//
//								Load helper files								//
//																				//
//////////////////////////////////////////////////////////////////////////////////

//	First loading tools file. These are general utilities for the server.
//	#ENV contains references for the route files.  This map will receive a #tools
//	key once tools is loaded.
//	Load route files, execute.
//
var ENV = {
	db_local	: db_local,
	redis		: redis,
	app			: app,
	config		: config,
	express		: express
};

var tools = new (require('./lib/tools.js'))(ENV);

ENV.tools = tools;

tools.walkDir("routes", function(err, res) {

	res = res || [];

	res.forEach(function(file) {
		(require("./" + file))(ENV);
	});
});

//////////////////////////////////////////////////////////////////////////////////
//																				//
//									Routes										//
//																				//
//////////////////////////////////////////////////////////////////////////////////

//	Added for Waywot exposure
//
app.post("/waywot", function(req, res) {
	res.writeHead(200, {
		"content-type" : "application/json"
	});
	res.end(JSON.stringify(app.routes));
});

//	For every route extend request object with #callId and #broadcastType headers
//
app.all("*", function(req, res, next) {

	var headers = req.headers;

	var broadcastType 	= (req.header('x-mies-broadcast') ||	req.query['x-mies-broadcast']) * 1;
	var sessId			= req.header('x-mies-sessid') || req.query['x-mies-sessid'];
	var callId 			= req.header('x-mies-callid') || req.query['x-mies-callid'];

	//	We are optimistic here. For some routes (particularly /login) there can be no
	//	user object yet. The response methods simply check when they are called, below.
	//
	req.clientObj = clientsById[sessId];
	
	if(req.clientObj) {
		clientsById[sessId].request = req;
	}

	//	This is a http response, unlike #broadcast.
	//	Use this for responses to HTTP requests, which should be few.
	//
	res.ok = function(data, headers) {

		headers	= headers || {};
		headers["content-type"] = "application/json";
		res.writeHead(200, headers);

		data = typeof data === "string" ? data : JSON.stringify(data || {});

		if(req.params.remote) {
			var route = req.route.path.replace(":remote?","");
			res.end("mies.route('" + route + "','broadcast',JSON.parse(unescape('" + escape(data) + "')));")
		} else {
			res.end(data);
		}

		return this;
	};

	//	Broadcast to all clients bound through a socket.
	//
	res.broadcast = function(msg) {

		//	Broadcasts are only to validated clients.
		//
		if(!req.clientObj || !req.clientObj.send) {
			res.end();
		} else if(req.params.remote) {
			msg = typeof msg === "string" ? msg : JSON.stringify(msg || {});
			var route = req.route.path.replace(":remote?","");
			res.end("mies.route('" + route + "','broadcast',JSON.parse(unescape('" + escape(msg) + "')));")
		} else {
			req.clientObj.send(callId, msg)
			res.end();
		}
		return this;
	};

	//	If there is a #broadcastType then the error is against a room call.
	//	We override the requested broadcast type, however, as call errors should
	//	not pollute everyones experience, even if requested.
	//
	//	If there is no #broadcastType then this is a non-room request, which is
	//	handled in a more standard way.
	//
	res.error = function(message, status) {
		if(broadcastType) {
			res.broadcast({
				error:  message
			});
		} else {
			res.writeHead(status || 500, {});
			res.end(JSON.stringify(message || {}));
		}
		return this;
	};

	req.divert = function(newpath) {
		req.route.path = newpath;
		return this;
	};

	//	Interface to MQ
	//
	req.queue = function(msg, queue, onComplete) {

		if(!req.clientObj || typeof msg !== "object") {
			return res.end();
		}

		if(typeof queue === "function") {
			onComplete = queue;
			queue = null;
		}

		if(onComplete) {
			onComplete = "return(" + onComplete.toString().replace(/[\t\n]+/g, "") + ")(msg,send,env);";
		}

		redis.setex(callId, config.trans_timeout_sec, onComplete, function(err) {

			msg = {
				meta : {
					sessionId 	: sessId,
					userId		: req.clientObj.username,
					route 		: req.route.path
				},
				message : msg
			};

			conn_publish.publish(queue || config.send_queue_name, msg, {
				correlationId : callId
			});
		});

		res.end();
		return this;
	};

	next();
});

//	Any attempt to enter the private/ directory requires an auth.
//	On auth, pass along the file.
//
app.all("/private*", tools.authorize, function(req, res) {
	res.sendfile(__dirname + "/www" + req.path);
});

//////////////////////////////////////////////////////////////////////////////////
//																				//
//								User Auth Routes								//
//																				//
//////////////////////////////////////////////////////////////////////////////////

var doAuth = function(req, res, next) {

	var username 	= req.body.username;
	var password 	= req.body.password;

	var finAuth = function() {
		tools.getPeerData(username, function(err, data) {

			if(!err && username === data.username && password === data.password) {

				var sessId = tools.createHash();

				sessionRequests[sessId] = {
					username	: username,
					email		: data.email,
					password	: password,
					sessId		: sessId
				};

				return res.ok({"sessionId" : sessId});
			}

			res.error("Bad Credentials");
		});
	};

	//	If no creds try to auth (or fetch previous auth), BasicAuth.
	//
	if(!username || !password) {
		return tools.basicAuth(req, res, function() {
			var authHeader 	= req.headers.authorization;
			if(authHeader) {
				var token	= authHeader.split(/\s+/).pop()	|| ""; 		// 	The encoded auth token
				var auth	= new Buffer(token, 'base64').toString();   // 	Convert from base64
				var parts 	= auth.split(/:/);

				username 	= parts[0];
				password	= parts[1];
			}

			if(!username || !password) {
				return res.error("Bad Credentials");
			}

			finAuth();
		});
	}

	finAuth();
};

//	Both GET and POST logins are sending plaintext over the
//	wire, so the implementer should ensure the safety of the communication
//	channel, usually by making this an HTTPS server.
//
//	TODO: a challenge/response hashed login system.
//	TODO: a digest auth system.
//
app.post('/login', doAuth);
app.get('/login', doAuth);

app.get('/anonlogin/', function(req, res) {

	var sessId = tools.createHash();

	sessionRequests[sessId] = {
		sessId		: sessId,
		username	: "guest"
	}

	res.ok({'sessionId' : sessId});
});

//////////////////////////////////////////////////////////////////////////////////
//																				//
//										Modules									//
//																				//
//////////////////////////////////////////////////////////////////////////////////

app.get('/module/:name/:auth?', function(req, res, next) {
	var name 	= req.params.name;
	var auth 	= req.params.auth || "";
	var path 	= __dirname + (auth === "true" ? "/www/private/modules/" : "/www/modules/") + name;
	var mpath	= path + "/module";

	if(auth === "true") {
		if(!req.clientObj || !req.clientObj.password) {
			return req.end();
		}
	}

	var build = function() {
		console.log("build");
		tools.walkDir(path, function(err, files) {
			var ret = {};

			if(err || !files.length) {
				return res.error("Module > " + name + " not found or empty");
			}

			var len = files.length;

			files.forEach(function(f) {

				var i 	= f.lastIndexOf(".") +1;
				var ext = f.substring(i, Infinity);

				//	For non-html files (css; js) we only load minified files.
				//	To minify, return to root and `make minify`
				//
				if(ext !== "html" && f.indexOf(".min." + ext) < 0) {
					--len;
					return;
				}

				fs.readFile(f, "utf-8", function(err, cont) {
					if(!err) {
						ret[ext] = (ret[ext] || "") + cont;
					}

					//	Once we've completed we store a compiled version (see above), then return.
					//
					if(!(--len)) {
						fs.writeFile(mpath, JSON.stringify(ret), function() {
							res.ok(ret);
						});
					}
				});
			});
		});
	};

	//	Check for pre-built module file.
	//	Check stat times, and rebuild if mods have occurred. If not, return compiled.
	//
	fs.stat(mpath, function(err, mstat) {
		if(!err && mstat) {
			return fs.stat(path, function(err, dstat) {
				if(err || !dstat) {
					// This should never happen
					//
					return res.error("System error in `modules`");
				}
				//	Last mod was `module` file. Send `module` file.
				//
				if(dstat.atime.getTime() === mstat.mtime.getTime()) {
					console.log("compiled")
					return res.sendfile(mpath);
				}
				build();
			});
		}
		//	No `module` file
		//
		build();
	});
});

//////////////////////////////////////////////////////////////////////////////////
//																				//
//										INIT SERVER								//
//																				//
//////////////////////////////////////////////////////////////////////////////////

if(protocol === "https") {
	server = https.createServer({
		key		: fs.readFileSync('rsa/private-key.pem'),
		cert	: fs.readFileSync('rsa/public-cert.pem')
	}, app).listen(port);
} else {
	server = http.createServer(app);
}

//////////////////////////////////////////////////////////////////////////////////
//																				//
//							SET UP SOCKET/SOURCE BINDINGS						//
//																				//
//////////////////////////////////////////////////////////////////////////////////

socketio = require('socket.io').listen(server, { log: false });
server.listen(port);

socketio.sockets.on('connection', function(socket) {

	var sessId = socket.manager.handshaken[socket.id].query.sessId;
	var clientObj;

	if(sessionRequests[sessId]) {
		clientObj = clientsById[sessId] = sessionRequests[sessId];
	}

	delete sessionRequests[sessId];

	//	Must have authed by this point.
	//
	if(!clientObj) {
		return;
	}

	clientObj.send = function(id, msg) {
		socket.emit("message", {
			id		: id,
			data	: msg
		});
	}

    socket.on('disconnect', function() {
    	delete clientsById[sessId];
  	});

	socket.emit("handshake", {
		userid: clientObj.username
	});
});

//	EventSource clients will call this route to bind.
//
app.post('/system/receive/:groupId/:sessId', function(req, res, next) {

	var sessId 	= req.params.sessId;
	var pinger;
	var user;

	req.pinger = null;

	if(sessionRequests[sessId]) {
		user = clientsById[sessId] = sessionRequests[sessId];
	}

	delete sessionRequests[sessId];
	
	//	Must have authed by this point.
	//
	if(!user) {
		return res.error("Not authorized");
	}

	user.send = function(id, msg) {
		var outMsg = 'id:' + id + '\ndata: ' + JSON.stringify(msg) + '\n\n';
		res.write(outMsg);
	};
			
    res.writeHead(200, {
      'Content-Type'				: 'text/event-stream',
      'Cache-Control'				: 'no-cache',
      'Connection'					: 'keep-alive',
      'Access-Control-Allow-Origin'	: '*'
    });

	//	2kb padding for IE
	//
    res.write(':' + Array(2049).join(' ') + '\n');

	//	Any time a client exits (is no longer alive)
	//
    res.socket.on('close', function() {
    	clearTimeout(req.pinger);
    	req = res = pinger = null;
		delete clientsById[sessId];
    });

	//	Sends a ping every #pingInterval milliseconds. This avoids attempts of client
	//	to re-connect after inactivity (varies client to client). The client is sent
	//	the #pingInterval, allowing the client to implement some tracking of the server,
	//	and do something if the server doesn't ping again in approx. #pingIntervalTime.
	//
	(pinger = function() {
		res.write('id: ping\n');
		res.write("data: " + '{"interval":"' + config.ping_interval + '"}' + '\n\n');
		req.pinger = setTimeout(pinger, config.ping_interval);
	})();
});

//////////////////////////////////////////////////////////////////////////////////
//																				//
//								REGISTER WITH SYSTEM							//
//																				//
//////////////////////////////////////////////////////////////////////////////////

process.title = db_prefix + "server";

console.log('Server running at ' +  protocol + "://" + host + ":" + port);
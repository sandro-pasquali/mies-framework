module.exports = function(env) {

	var app 	= env.app;
	var tools	= env.tools;
	var auth	= env.tools.authorize;

	//	A test
	//
	app.post("/demo/helloworld", function(req, res) {
		res.broadcast({
			data: {"hello":"world"}
		});
	});

	app.post("/demo/echo", function(req, res) {
		res.broadcast(req.body);
	});

	app.post("/demo/mq", auth, function(req, res) {
		req.queue(req.body, 'ReplyQueue');
	});
};
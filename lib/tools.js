var fs 		= require('fs');
var crypto 	= require('crypto');
var uuid 	= require('node-uuid');

module.exports = function(env) {

	var db_usertable	= env.config.db_prefix + ":" + "users";

	this.createHash = function() {
		return crypto.createHash('sha256').update(uuid.v4() + Math.random()).digest('hex');
	};

	//	##getPeerData
	//
	//	Fetch data for a given peer, key being email.
	//
	this.getPeerData = function(username, cb) {
		env.redis.hget(db_usertable, username, function(err, data) {
			if(err || !data) {
				return cb(err || true, null, null);
			}
			data = JSON.parse(data);

			cb(null, data);
		});
	};

	//	Add this to your route handling chain when a route requires full auth
	//	(not guest access). If there is a #clientObj with a u/p the user
	//	has already been authenticated.
	//
	this.authorize = function(req, res, next) {
		if(!req.clientObj || !req.clientObj.password) {
			return res.error("Not authorized");
		}

		next(null);
	};

	this.basicAuth = (function(_this) {

		var failMessage = "Enter your login information";

		return env.express.basicAuth(function(username, password, fn) {
			_this.getPeerData(username, function(err, data) {

				//	No such username (email)
				//
				if(!data) {
					return fn(null, null);
				}

				//	In a logged out state. Clear that state, and ask for
				//	auth, as per normal.
				//
				//if(data.loggedout) {
					//updateRedisHash(CONFIG.peers, email, "loggedout", false);
					//return fn(null, null);
				//}

				//	Valid login
				//
				if(password === data.password) {
					return fn(null, data);
				}

				//	Invalid login
				//
				fn(null, null);
			})
		}, failMessage);
	})(this);

	this.byteLength = function(string) {
	 	return encodeURI(string).split(/%..|./).length - 1;
	};

	this.walkDir = function(dir, done) {
		var _this = this;
		var results = [];
		fs.readdir(dir, function(err, list) {
			if(err) {
				return done(err);
			}
			var pending = list.length;
			if(!pending) {
				return done(null, results);
			}
			list.forEach(function(file) {
				file = dir + '/' + file;
				fs.stat(file, function(err, stat) {
					if(stat && stat.isDirectory()) {
						_this.walkDir(file, function(err, res) {
							results = results.concat(res);
							if(!--pending) {
								done(null, results);
							}
						});
					} else {
						results.push(file);
						if(!--pending) {
							done(null, results);
						}
					}
				});
			});
		});
	};

    //	##murmurhash
    //
	//	JS Implementation of MurmurHash3 (r136) (as of May 20, 2011)
	//
	//	@author <a href="mailto:gary.court@gmail.com">Gary Court</a>
	//	@see http://github.com/garycourt/murmurhash-js
	//	@author <a href="mailto:aappleby@gmail.com">Austin Appleby</a>
	//	@see http://sites.google.com/site/murmurhash/
	//
	//	@param {string} key ASCII only
	//	@param {number} seed Positive integer only
	//	@return {number} 32-bit positive integer hash
	//
	this.murmurhash = function(key, seed) {
		var remainder, bytes, h1, h1b, c1, c1b, c2, c2b, k1, i;

		remainder = key.length & 3; // key.length % 4
		bytes = key.length - remainder;
		h1 = seed;
		c1 = 0xcc9e2d51;
		c2 = 0x1b873593;
		i = 0;

		while (i < bytes) {
			k1 =
			  ((key.charCodeAt(i) & 0xff)) |
			  ((key.charCodeAt(++i) & 0xff) << 8) |
			  ((key.charCodeAt(++i) & 0xff) << 16) |
			  ((key.charCodeAt(++i) & 0xff) << 24);
			++i;

			k1 = ((((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16))) & 0xffffffff;
			k1 = (k1 << 15) | (k1 >>> 17);
			k1 = ((((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16))) & 0xffffffff;

			h1 ^= k1;
			h1 = (h1 << 13) | (h1 >>> 19);
			h1b = ((((h1 & 0xffff) * 5) + ((((h1 >>> 16) * 5) & 0xffff) << 16))) & 0xffffffff;
			h1 = (((h1b & 0xffff) + 0x6b64) + ((((h1b >>> 16) + 0xe654) & 0xffff) << 16));
		}

		k1 = 0;

		switch (remainder) {
			case 3: k1 ^= (key.charCodeAt(i + 2) & 0xff) << 16;
			case 2: k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8;
			case 1: k1 ^= (key.charCodeAt(i) & 0xff);

			k1 = (((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff;
			k1 = (k1 << 15) | (k1 >>> 17);
			k1 = (((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff;
			h1 ^= k1;
		}

		h1 ^= key.length;

		h1 ^= h1 >>> 16;
		h1 = (((h1 & 0xffff) * 0x85ebca6b) + ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) & 0xffffffff;
		h1 ^= h1 >>> 13;
		h1 = ((((h1 & 0xffff) * 0xc2b2ae35) + ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16))) & 0xffffffff;
		h1 ^= h1 >>> 16;

		return h1 >>> 0;
	};
};
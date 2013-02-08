#	If you are going to use `make start/stop` this will be the (server) file targeted.
#	If you are proxying (multiple mies servers) you may want to change this name (and
#	its corresponding file-name) to achieve unique pid's.
#
NODE_SERVER				= mies-server.js

CSS_FILES				= $(shell find www -not -name "*.min.css" -name '*.css')
JS_FILES				= $(shell find www -not -name "*.min.js" -name '*.js')
CSS_MINIFIED			= $(CSS_FILES:.css=.min.css)
JS_MINIFIED				= $(JS_FILES:.js=.min.js)
YUI_COMPRESSOR			= java -jar bin/yuicompressor-2.4.8pre.jar
YUI_COMPRESSOR_FLAGS	= --charset utf-8
CLOSURE_COMPILER		= java -jar bin/compiler.jar
CLOSURE_FLAGS			=

#	This sample test which simply ensures that at least one test exists
#	when we stress our test harness on make.
#
SAMPLE_SPEC = "\
var should 	= require('should');\
var Person = require(__dirname + '/src/dummy-test-to-erase.js');\
describe('Person', function() {\
	it('should say hello', function() {\
		var person 	= new global.miesTesting.Person;\
		person.sayHello('Sandro').should.equal('Hello, Sandro!');\
	});\
});"


SAMPLE_SRC = "global.miesTesting = {};\
global.miesTesting.Person = function() {\
	this.sayHello = function(to) {\
		return 'Hello, ' + to + '!';\
	};\
};"

SAMPLE_SPEC_FILENAME	= "test/dummy-test-to-erase_spec.js"
SAMPLE_SRC_FILENAME		= "test/src/dummy-test-to-erase.js"

#	These are public folder targets, which will receive copies of
#	/node_modules/mies/mies.js and /node_modules/bauhaus/bauhaus.js
#	making it easy to include libs on client.
#
MIES_CLIENT		= "www/public/js/mies.js"
BAUHAUS_CLIENT	= "www/public/js/bauhaus.js"
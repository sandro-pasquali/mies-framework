include bin/config.mk

all: check-build force

force: stop clean clean-db update build minify test closer

update: minify-clean update-git update-npm minify test

update-git:
	@echo "******************************************************************************"
	@echo "UPDATING SUBMODULES"
	@echo "******************************************************************************"

	@git submodule update --init --recursive
	@git submodule foreach git pull origin master

update-npm:
	@echo "******************************************************************************"
	@echo "UPDATING NPM"
	@echo "******************************************************************************"

	@npm update
	@npm install forever -g
	@cp node_modules/mies/mies.js $(MIES_CLIENT)
	@cp node_modules/bauhaus/bauhaus.js $(BAUHAUS_CLIENT)

build:
	@bash bin/sqlite3installer

minify: minify-css minify-js

minify-css: $(CSS_FILES) $(CSS_MINIFIED)

minify-js: $(JS_FILES) $(JS_MINIFIED)

%.min.css: %.css
	$(YUI_COMPRESSOR) $(YUI_COMPRESSOR_FLAGS) --type css $< >$@

%.min.js: %.js
	$(YUI_COMPRESSOR) $(YUI_COMPRESSOR_FLAGS) --type js $< >$@

#	Removes all .min js/css files.
#
minify-clean:
	rm -f $(CSS_MINIFIED) $(JS_MINIFIED)

# 	Removes minified CSS and JS files, sample tests, as well as any built databases/keys.
#
clean: minify-clean clean-db
	@test $(SAMPLE_SPEC_FILENAME) || rm $(SAMPLE_SPEC_FILENAME)
	@test $(SAMPLE_SRC_FILENAME) || rm $(SAMPLE_SRC_FILENAME)
	@node bin/clean
	
#	Removes core sqlite db's, on make.
#
clean-db:
	@echo "******************************************************************************"
	@echo "REMOVING SQLITE DB"
	@echo "******************************************************************************"
	@rm -f db/*.db;

#	@see https://github.com/nodejitsu/forever
#
start:
	@forever start -a -l $(CURDIR)/logs/server.log $(NODE_SERVER)
	@echo "** Started"

start-devel:
	@forever start -w --watchDirectory www -a -l $(CURDIR)/logs/server.log $(NODE_SERVER)
	@echo "** Started in Development Mode (file watching)"

stop:
	@forever stop $(NODE_SERVER)
	@echo "** Stopped"
	
adduser:
	@node bin/adduser
	
removeuser:
	@node bin/removeuser
	
help:
	@echo '>make    - Builds the system. Running `make` will *DESTROY ANY EXISTING BUILD* so you probably'
	@echo '           want to only run it once. To update afterwards, use `make update`.'
	@echo
	@echo '>make clean  - Delete all minified css/js files, along with tests, and other build-specific files.'
	@echo '               This *DESTROYS YOUR BUILD*. You might prefer `make minify-clean` or `make update`.'
	@echo
	@echo '>make update     - Update git submodules, npm modules, re-minifies tree, runs tests.'
	@echo '                   This is safe to run at any time.
	@echo '>make update-git - Only update git submodules.'
	@echo '>make update-npm - Only update npm packages.'
	@echo
	@echo '>make test   - Run tests.'
	@echo
	@echo
	@echo '>make start       - Run the server as a daemon.'
	@echo '>make start-devel - Same as start, but now any changes made within the /www directory'
	@echo '                    will cause a server restart. Helpful while developing, but likely'
	@echo '                    not in production (ie. restarts destroy all client connections)'
	@echo
	@echo '>make stop   - Stop the server daemon.'
	@echo
	@echo
	@echo '>make adduser        - Add a user. You should do this following initial `make`.'
	@echo
	@echo
	@echo '>make removeuser     - Remove a user.'
	@echo
	@echo 'Minifying:           **NOTE** Using > yuicompressor --charset utf-8 --verbose.'
	@echo '>make minify         - Minify all .js AND .css files.'
	@echo '>make minify-css     - Minify all .css files.'
	@echo '>make minify-js      - Minify all .js files.'
	@echo '>make minify-clean   - Removes all .min js/css files.'
	@echo

#	make will first check to see if /db/admin.db exists (which is the system sqlite db). If that
#	exists, then a build has already been done. Warn.
#
check-build:
	@if [ -f $(CURDIR)/db/admin.db ]; then echo "Already built. If you want to force a rebuild use > make force, which will DESTROY ALL YOUR DATA IN ALL DATABASES AND RE-MAKE!! You probably do not want that. Maybe > make update is enough?"; exit 1; fi;

test-build:
	@test -d test/src || mkdir test/src

	@echo "Creating a sample SPEC file ($(SAMPLE_SPEC_FILENAME)), for testing."
	@echo $(SAMPLE_SPEC) > $(SAMPLE_SPEC_FILENAME)
	@echo "Creating a sample SRC file ($(SAMPLE_SRC_FILENAME)), for testing."
	@echo $(SAMPLE_SRC)	> $(SAMPLE_SRC_FILENAME)

#	Create a sample test file, and run tests
#
#	A test/ directory should exist in the distribution (containing at least one test).
#	The src/ subdir is not necessarily present, and we'll need it if not.
#
test: test-build
	@echo "******************************************************************************"
	@echo "RUNNING TESTS"
	@echo "******************************************************************************"

	@export NODE_PATH=.; \
	./node_modules/mocha/bin/mocha \
	--reporter list

closer:
	@echo "******************************************************************************"
	@echo
	@echo "NOTE that the RSA keys in /rsa are solely for development and should not be"
	@echo "used in production."
	@echo 
	@echo "You now will probably want to add a user. Run > make adduser"
	@echo
	@echo "******************************************************************************"

.PHONY: force check-build update update-git update-npm build test test-build help clean clean-db start start-devel stop minify minify-css minify-js minify-clean adduser removeuser closer
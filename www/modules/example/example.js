$.get("/login", function(sessid) {

	mies.join("adhoc", sessid, function() {
		console.log("The `example` module js has loaded!")
	});
	
});

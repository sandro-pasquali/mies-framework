$(function() {
	//	Test the system
	//
	console.log("If what follows is an Object {'hello':'world'} the installation was successful.");
	
	$.get("/anonlogin", function(data) {
	
		var sessId = data.sessionId;
	
		mies
		.subscribe("/demo/helloworld")
		.broadcast(function() {
			console.log(this)
		})
		
		.subscribe("/demo/echo")
		.broadcast(function() {
			console.log(this);
			$("#echo").data(this);
		})
		.action(function() {
			mies.publish("/demo/echo", {
				data: $(this.target).text()
			});
		})
		
		.subscribe("/demo/select")
		.change(function() {
			console.log(this)
		})
		
		.join("adhoc", sessId, function() {
			mies.publish("/demo/helloworld");
		})
	});
});

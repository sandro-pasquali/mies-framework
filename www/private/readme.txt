The files in the /www/public folder can be accessed by anyone. Someone could simply type yoururl.com/file.html and see that file.

The files in the /private folder can only be accessed by authenticated users. This means users with passwords -- this is NOT a truly secure folder where you should put sensitive information like passwords etc. It is a folder containing files accessible via http for authenticated users.  To make files INACCESSIBLE drop them below the /www folder.

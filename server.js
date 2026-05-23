const express = require("express");

const app = express();

app.get("/", (req, res) => {
  res.send("NAPAS PROXY RUNNING 🚀");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

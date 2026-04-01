const { MongoClient } = require("mongodb");

const client = new MongoClient(process.env.MONGO_URI);

async function connectDB() {
    if (!client.topology || !client.topology.isConnected()) {
        await client.connect();
        console.log("MongoDB Connected");
    }
    return client.db("my_database"); // change name if needed
}

module.exports = connectDB;

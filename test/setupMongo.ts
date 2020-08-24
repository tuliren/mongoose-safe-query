import mongoose from 'mongoose';

const MONGO_URI = 'mongodb://localhost/mongoose-safe-query';

before('Initialize mongo db', async () => {
  if (!mongoose.connection.readyState) {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  }
});

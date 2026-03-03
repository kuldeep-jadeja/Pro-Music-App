import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            index: true,
        },
        passwordHash: {
            type: String,
            required: true,
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
    },
    { timestamps: true }
);

// Strip passwordHash from all JSON / object responses by default.
UserSchema.set('toJSON', {
    transform(_doc, ret) {
        delete ret.passwordHash;
        return ret;
    },
});

UserSchema.set('toObject', {
    transform(_doc, ret) {
        delete ret.passwordHash;
        return ret;
    },
});

export default mongoose.models.User || mongoose.model('User', UserSchema);

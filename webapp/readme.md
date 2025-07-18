<div align="center">
  <img src="https://i.imgur.com/PNqflHV.png" alt="Minesible - The power of OpenTofu + Ansible" />
</div>

# 🎮 Minesible Web Manager 
**A modern web interface for managing Minecraft servers with Spacelift, OpenTofu, and Ansible**

## 🚀 Features

✅ **One-click server deployment** - Deploy Minecraft servers instantly using Spacelift blueprints  
✅ **Real-time server management** - View status, IP addresses, and server details  
✅ **World persistence** - Automatic world saves to S3 with manual save triggers  
✅ **Secure deletion** - Safe server teardown with optional world backup  
✅ **Run history & logs** - View Spacelift execution logs and deployment history  
✅ **Responsive design** - Works on desktop, tablet, and mobile devices  
✅ **Modern UI** - Clean, intuitive interface with real-time status updates  

---

## 🛠️ Tech Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Backend**: Node.js with Vercel Serverless Functions
- **Infrastructure**: OpenTofu (Terraform) + Ansible
- **Orchestration**: Spacelift
- **Cloud**: AWS (EC2, S3, IAM)
- **Deployment**: Vercel

---

## 📋 Prerequisites

Before deploying, ensure you have:

1. **Spacelift Account** with API access
2. **AWS Account** configured in Spacelift
3. **Minesible Blueprint** deployed in Spacelift (see [minesible](../README.md))
4. **Vercel Account** for hosting

---

## 🚀 Quick Deploy

### Option 1: Deploy to Vercel (Recommended)

1. **Fork this repository**
2. **Click the Deploy button above** or go to [Vercel](https://vercel.com/new)
3. **Import your forked repository**
4. **Set Root Directory** to `webapp`
5. **Configure environment variables** (see below)
6. **Deploy!**

### Option 2: Manual Deployment

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/minesible.git
cd minesible/webapp

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your values

# Deploy to Vercel
npx vercel --prod
```

---

## ⚙️ Environment Variables

Configure these in your Vercel project settings:

| Variable | Description | Example |
|----------|-------------|---------|
| `SPACELIFT_API_ENDPOINT` | Your Spacelift GraphQL API URL | `https://your-org.app.spacelift.io/graphql` |
| `SPACELIFT_API_KEY_ID` | Spacelift API Key ID | `your-key-id` |
| `SPACELIFT_API_KEY_SECRET` | Spacelift API Key Secret | `your-secret-key` |
| `BLUEPRINT_ID` | Your Minesible Blueprint ID | `minesible-blueprint-xxxxx` |
| `NODE_ENV` | Environment | `production` |

### 🔐 How to Get Spacelift API Keys

1. Go to your **Spacelift account settings**
2. Navigate to **API Keys**
3. Click **Create API Key**
4. Copy the ID and Secret
5. Add them to your Vercel environment variables

---

## 📁 Project Structure

```
webapp/
├── api/                    # Vercel serverless functions
│   ├── deploy.js          # Server deployment endpoint
│   ├── servers.js         # Server management endpoints
│   ├── health.js          # Health check endpoint
│   ├── test.js           # API testing endpoint
│   └── debug-permissions.js # Permission debugging
├── public/
│   └── index.html        # Main web interface
├── package.json          # Dependencies
├── .env.example         # Environment variables template
└── README.md            # This file
```

---

## 🎯 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/test` | Test Spacelift connection |
| `POST` | `/api/deploy` | Deploy new Minecraft server |
| `GET` | `/api/servers` | List all servers |
| `GET` | `/api/servers/:id` | Get specific server details |
| `POST` | `/api/servers/:id/save` | Save world to S3 |
| `GET` | `/api/servers/:id/spacelift-logs` | Get deployment logs |
| `DELETE` | `/api/servers/:id` | Delete server (with optional world save) |

---

## 🎮 Usage

### Deploy a New Server

1. **Fill out the deployment form:**
   - **Instance Type**: Choose EC2 instance size (t3.micro to t3.large)
   - **S3 Bucket**: Bucket name for world saves
   - **MOTD**: Server message of the day
   - **Max Players**: Maximum concurrent players

2. **Click "Deploy Server"**
3. **Wait for deployment** (typically 3-5 minutes)
4. **Server will appear** in the Active Servers list

### Manage Existing Servers

- **💾 Save World**: Manually backup world to S3
- **📋 View History**: See deployment logs and run history
- **🗑️ Delete Server**: Remove server with optional world backup

### Server Status Types

- **🟢 Ready**: Server is running and accessible
- **🔵 Deploying**: Server deployment in progress
- **🟡 Planning**: Terraform planning phase
- **🟡 Pending Confirmation**: Waiting for user confirmation
- **🔴 Failed**: Deployment or server failed
- **⚪ Incomplete**: Missing required stacks

---

## 🐛 Troubleshooting

### Common Issues

**❌ "Failed to load servers: HTTP error! status: 404"**
- Check that environment variables are set correctly
- Verify your Spacelift API keys have proper permissions
- Test API connectivity with `/api/test`

**❌ "Blueprint not found" error**
- Ensure your `BLUEPRINT_ID` environment variable is correct
- Verify the blueprint exists in your Spacelift account
- Check that your API key has access to the blueprint

**❌ "Permission denied" errors**
- Verify your Spacelift API key has admin permissions
- Check that the API key hasn't expired
- Ensure your AWS integration is properly configured in Spacelift

### Debug Endpoints

- **Health Check**: `https://your-app.vercel.app/api/health`
- **API Test**: `https://your-app.vercel.app/api/test`
- **Permissions**: `https://your-app.vercel.app/api/debug-permissions`

---

## 🔧 Development

### Local Development

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/minesible.git
cd minesible/webapp

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Spacelift credentials

# Start development server (for API testing)
npm run dev

# Or use Vercel CLI for full serverless simulation
npx vercel dev
```

### Project Dependencies

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "axios": "^1.6.0",
    "dotenv": "^16.3.1"
  }
}
```

---

**Built with ❤️ by the Spacelift community**

[🌟 Star this repo](https://github.com/spacelift-solutions/minesible) | [🐛 Report Bug](https://github.com/spacelift-solutions/minesible/issues) | [💡 Request Feature](https://github.com/spacelift-solutions/minesible/issues)

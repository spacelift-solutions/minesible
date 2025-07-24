// This handles the GET/POST/DELETE /api/servers/:id
// webapp/api/servers/[id].js
// Dynamic route handler for individual server operations

require('dotenv').config();
const axios = require('axios');

// Spacelift API configuration
const SPACELIFT_API_URL = process.env.SPACELIFT_API_ENDPOINT;
const SPACELIFT_API_KEY_ID = process.env.SPACELIFT_API_KEY_ID;
const SPACELIFT_API_KEY_SECRET = process.env.SPACELIFT_API_KEY_SECRET;

// Validate required environment variables
if (!SPACELIFT_API_URL || !SPACELIFT_API_KEY_ID || !SPACELIFT_API_KEY_SECRET) {
    console.error('Missing required environment variables');
}

// Cache for JWT token
let currentJWT = null;
let jwtExpiry = null;

// Function to get JWT token from API key
async function getJWTToken() {
    if (currentJWT && jwtExpiry && Date.now() < jwtExpiry) {
        return currentJWT;
    }

    try {
        const response = await axios.post(SPACELIFT_API_URL, {
            query: `
                mutation GetSpaceliftToken($id: ID!, $secret: String!) {
                    apiKeyUser(id: $id, secret: $secret) {
                        jwt
                    }
                }
            `,
            variables: {
                id: SPACELIFT_API_KEY_ID,
                secret: SPACELIFT_API_KEY_SECRET
            }
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data.errors) {
            throw new Error(response.data.errors[0].message);
        }

        currentJWT = response.data.data.apiKeyUser.jwt;
        jwtExpiry = Date.now() + (50 * 60 * 1000);
        
        return currentJWT;
    } catch (error) {
        console.error('Failed to get JWT token:', error.response?.data || error.message);
        throw error;
    }
}

// GraphQL helper function
async function spaceliftQuery(query, variables = {}) {
    try {
        const jwt = await getJWTToken();
        
        const response = await axios.post(SPACELIFT_API_URL, {
            query,
            variables
        }, {
            headers: {
                'Authorization': `Bearer ${jwt}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.data.errors) {
            console.error('GraphQL errors:', response.data.errors);
            throw new Error(response.data.errors[0].message);
        }

        return response.data.data;
    } catch (error) {
        console.error('Spacelift API error:', error.response?.data || error.message);
        throw error;
    }
}

module.exports = async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Extract the server ID from the URL
    const { id: serverId } = req.query;
    
    console.log('=== DYNAMIC ROUTE DEBUG ===');
    console.log('Method:', req.method);
    console.log('Server ID:', serverId);
    console.log('URL:', req.url);

    try {
        // Handle different HTTP methods and URL patterns
        if (req.method === 'GET') {
            // Check if this is a request for Spacelift logs
            if (req.url && req.url.includes('/spacelift-logs')) {
                return await handleSpaceliftLogs(req, res, serverId);
            } else {
                // Regular GET request for server details
                return await handleGetServer(req, res, serverId);
            }
        }
        
        if (req.method === 'POST') {
            // Check if this is a save world request
            if (req.url && req.url.includes('/save')) {
                return await handleSaveWorld(req, res, serverId);
            }
        }
        
        if (req.method === 'DELETE') {
            return await handleDeleteServer(req, res, serverId);
        }

        return res.status(405).json({
            success: false,
            error: `Method ${req.method} not allowed for this endpoint`
        });

    } catch (error) {
        console.error('Dynamic route error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

// Handler for GET /api/servers/:id
async function handleGetServer(req, res, serverId) {
    console.log('Getting server details for:', serverId);
    
    const getStackQuery = `
        query GetStack($id: ID!) {
            stack(id: $id) {
                id
                name
                state
                createdAt
                outputs {
                    id
                    value
                }
                labels
                latestRun {
                    id
                    state
                    createdAt
                    finishedAt
                }
            }
        }
    `;

    const result = await spaceliftQuery(getStackQuery, { id: serverId });
    
    if (!result.stack) {
        return res.status(404).json({
            success: false,
            error: 'Stack not found'
        });
    }

    if (!result.stack.labels || !result.stack.labels.includes('minesible')) {
        return res.status(404).json({
            success: false,
            error: 'Server not found (not a minesible stack)'
        });
    }

    const stack = result.stack;
    const outputs = stack.outputs ? stack.outputs.reduce((acc, output) => {
        acc[output.id] = output.value;
        return acc;
    }, {}) : {};

    return res.json({
        success: true,
        server: {
            id: stack.id,
            name: stack.name,
            status: stack.state,
            ip: outputs.ec2_ip || null,
            instanceType: outputs.instance_type || 'unknown',
            maxPlayers: outputs.max_players || 'unknown',
            created: stack.createdAt,
            latestRun: stack.latestRun
        }
    });
}

// Handler for POST /api/servers/:id/save
async function handleSaveWorld(req, res, serverId) {
    console.log('Saving world for server:', serverId);
    
    const getStackQuery = `
        query GetStack($id: ID!) {
            stack(id: $id) {
                id
                name
                labels
            }
        }
    `;

    const stackResult = await spaceliftQuery(getStackQuery, { id: serverId });
    
    if (!stackResult.stack || !stackResult.stack.labels || !stackResult.stack.labels.includes('minesible')) {
        return res.status(404).json({
            success: false,
            error: 'Server not found'
        });
    }

    // Extract the random string from the stack name to find the corresponding Ansible stack
    const randomString = stackResult.stack.name.split('-').pop();
    const ansibleStackName = `Minesible-Ansible-Blueprint-${randomString}`;

    console.log('Looking for Ansible stack:', ansibleStackName);

    const getAllStacksQuery = `
        query GetAllStacks {
            stacks {
                id
                name
                labels
            }
        }
    `;

    const allStacksResult = await spaceliftQuery(getAllStacksQuery);
    const ansibleStack = allStacksResult.stacks.find(stack => 
        stack.name === ansibleStackName && 
        stack.labels && 
        stack.labels.includes('minesible')
    );

    if (!ansibleStack) {
        return res.status(404).json({
            success: false,
            error: `Ansible stack not found: ${ansibleStackName}`
        });
    }

    const triggerTaskMutation = `
        mutation TriggerTask($stackId: ID!, $command: String!) {
            taskTrigger(
                stack: $stackId,
                command: $command
            ) {
                id
                state
            }
        }
    `;

    const taskResult = await spaceliftQuery(triggerTaskMutation, {
        stackId: ansibleStack.id,
        command: 'ansible-playbook save-world.yml'
    });

    return res.json({
        success: true,
        taskId: taskResult.taskTrigger.id,
        message: 'World save task triggered successfully'
    });
}

// Handler for GET /api/servers/:id/spacelift-logs
async function handleSpaceliftLogs(req, res, stackId) {
    console.log('Getting Spacelift logs for stack:', stackId);
    
    const formatDate = (dateValue) => {
        if (!dateValue) return 'Unknown';
        
        let date;
        if (typeof dateValue === 'number') {
            date = new Date(dateValue > 1000000000000 ? dateValue : dateValue * 1000);
        } else {
            date = new Date(dateValue);
        }
        
        if (isNaN(date.getTime()) || date.getFullYear() < 2020) {
            return 'Invalid date';
        }
        
        return date.toLocaleString();
    };

    const getStackWithRunsQuery = `
        query GetStackWithRuns($stackId: ID!) {
            stack(id: $stackId) {
                id
                name
                state
                createdAt
                runs {
                    id
                    type
                    state
                    createdAt
                    finished
                    branch
                    triggeredBy
                }
            }
        }
    `;

    let stackResult;
    try {
        stackResult = await spaceliftQuery(getStackWithRunsQuery, { stackId });
    } catch (runsError) {
        console.log('Failed to get runs, trying basic stack info:', runsError.message);
        
        // Fallback to basic stack info
        const basicStackQuery = `
            query GetBasicStack($id: ID!) {
                stack(id: $id) {
                    id
                    name
                    state
                    createdAt
                }
            }
        `;
        
        try {
            stackResult = await spaceliftQuery(basicStackQuery, { id: stackId });
        } catch (basicError) {
            return res.status(500).json({
                success: false,
                error: `Failed to fetch stack information: ${basicError.message}`
            });
        }
    }
    
    if (!stackResult.stack) {
        return res.status(404).json({
            success: false,
            error: 'Stack not found'
        });
    }

    const stack = stackResult.stack;
    const runs = stack.runs || [];
    const latestRun = runs[0];
    
    console.log('Stack found:', stack.name, 'State:', stack.state);
    console.log('Found runs:', runs.length);

    let logInfo = `=== STACK INFORMATION ===
Stack Name: ${stack.name}
Stack ID: ${stack.id}
Current State: ${stack.state}
Created: ${formatDate(stack.createdAt)}

`;

    if (latestRun) {
        logInfo += `=== LATEST RUN ===
Run ID: ${latestRun.id}
Type: ${latestRun.type}
State: ${latestRun.state}
Branch: ${latestRun.branch || 'N/A'}
Triggered By: ${latestRun.triggeredBy || 'Unknown'}
Started: ${formatDate(latestRun.createdAt)}
${latestRun.finished ? `Finished: ${formatDate(latestRun.finished)}` : 'Still running...'}

`;
    }

    if (runs.length > 1) {
        logInfo += `=== RECENT RUNS ===
`;
        runs.slice(1, 6).forEach((run, index) => {
            logInfo += `${index + 2}. ${run.type} - ${run.state} - ${formatDate(run.createdAt)}
`;
        });
        logInfo += `
`;
    } else if (runs.length === 0) {
        logInfo += `=== RUN HISTORY ===
No run history available through API.

`;
    }

    logInfo += `=== DETAILED LOGS ===
For complete execution logs with real-time updates, visit:
https://spacelift-solutions.app.spacelift.io/stack/${stackId}

=== API LIMITATIONS ===
The Spacelift GraphQL API has limited log access. For full logs:
1. Click the link above to view in Spacelift UI
2. Use the Spacelift CLI: 'spacelift stack logs ${stackId}'
3. Check the Functions tab in Spacelift for real-time updates`;

    return res.json({
        success: true,
        logs: logInfo,
        stackName: stack.name,
        runCount: runs.length,
        latestRun: latestRun ? {
            id: latestRun.id,
            type: latestRun.type,
            state: latestRun.state,
            createdAt: latestRun.createdAt,
            finished: latestRun.finished
        } : null,
        note: 'Complete execution logs available in Spacelift UI',
        spaceliftUrl: `https://spacelift-solutions.app.spacelift.io/stack/${stackId}`
    });
}

// Handler for DELETE /api/servers/:id
async function handleDeleteServer(req, res, serverId) {
    console.log('=== STARTING SERVER DELETION ===');
    console.log('Server ID:', serverId);
    
    // Parse request body for saveWorld option
    let body = {};
    if (req.body) {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
    const { saveWorld } = body;
    
    console.log('Save world first:', saveWorld);

    const destroyStackMutation = `
        mutation DeleteStack($id: ID!, $destroyResources: Boolean) {
            stackDelete(id: $id, destroyResources: $destroyResources) {
                id
            }
        }
    `;
    
    const destroyResults = [];
    let saveMessage = '';
    const statusUpdates = [];

    // Helper function to add status update
    function addStatusUpdate(message, type = 'info') {
        const update = {
            timestamp: new Date().toISOString(),
            message,
            type
        };
        statusUpdates.push(update);
        console.log(`[${type.toUpperCase()}] ${message}`);
    }

    addStatusUpdate('Starting server deletion process...', 'info');

    const getStackQuery = `
        query GetStack($id: ID!) {
            stack(id: $id) {
                id
                name
                labels
                state
            }
        }
    `;

    const stackResult = await spaceliftQuery(getStackQuery, { id: serverId });
    
    if (!stackResult.stack) {
        return res.status(404).json({
            success: false,
            error: 'Stack not found',
            statusUpdates
        });
    }

    if (!stackResult.stack.labels || !stackResult.stack.labels.includes('minesible')) {
        return res.status(404).json({
            success: false,
            error: 'Server not found (not a minesible stack)',
            statusUpdates
        });
    }

    addStatusUpdate(`Found stack: ${stackResult.stack.name} (${stackResult.stack.state})`, 'info');

    // Handle direct stack deletion
    if (stackResult.stack.name.includes('Opentofu') || stackResult.stack.name.includes('Ansible')) {
        addStatusUpdate('Direct stack deletion detected', 'info');
        
        // If deleting OpenTofu stack, find and delete Ansible stack first
        if (stackResult.stack.name.toLowerCase().includes('opentofu')) {
            addStatusUpdate('OpenTofu stack deletion - checking for dependent stacks...', 'info');
            
            // Extract the blueprint identifier to find the corresponding Ansible stack
            const blueprintMatch = stackResult.stack.name.match(/Blueprint-([A-Za-z0-9]+)$/);
            if (blueprintMatch) {
                const randomString = blueprintMatch[1];
                const ansibleStackName = `Minesible-Ansible-Blueprint-${randomString}`;
                
                addStatusUpdate(`Looking for Ansible stack: ${ansibleStackName}`, 'info');
                
                // Find the Ansible stack
                const getAllStacksQuery = `
                    query GetAllStacks {
                        stacks {
                            id
                            name
                            labels
                            state
                        }
                    }
                `;

                const allStacksResult = await spaceliftQuery(getAllStacksQuery);
                const ansibleStack = allStacksResult.stacks.find(stack => 
                    stack.name === ansibleStackName && 
                    stack.labels && 
                    stack.labels.includes('minesible')
                );
                
                if (ansibleStack) {
                    addStatusUpdate(`Found dependent Ansible stack: ${ansibleStack.name} (${ansibleStack.state})`, 'info');
                    addStatusUpdate('Deleting Ansible stack first (dependency requirement)...', 'warning');
                    
                    try {
                        const ansibleResult = await spaceliftQuery(destroyStackMutation, {
                            id: ansibleStack.id,
                            destroyResources: true
                        });
                        destroyResults.push({ 
                            stack: 'ansible', 
                            stackId: ansibleStack.id,
                            deleted: true,
                            result: ansibleResult.stackDelete
                        });
                        addStatusUpdate(`✅ Ansible stack deleted successfully: ${ansibleStack.name}`, 'success');
                        
                        // Wait a bit before deleting OpenTofu stack
                        addStatusUpdate('Waiting 10 seconds before deleting OpenTofu stack...', 'info');
                        await new Promise(resolve => setTimeout(resolve, 10000));
                        
                    } catch (ansibleError) {
                        addStatusUpdate(`❌ Ansible stack deletion failed: ${ansibleError.message}`, 'error');
                        destroyResults.push({ 
                            stack: 'ansible', 
                            stackId: ansibleStack.id,
                            error: ansibleError.message 
                        });
                        addStatusUpdate('Continuing with OpenTofu deletion despite Ansible failure...', 'warning');
                    }
                } else {
                    addStatusUpdate('No dependent Ansible stack found, proceeding with OpenTofu deletion', 'info');
                }
            }
        } else {
            addStatusUpdate('Ansible stack deletion - no dependencies to check', 'info');
        }
        
        // Now delete the requested stack
        const stackType = stackResult.stack.name.includes('Opentofu') ? 'OpenTofu' : 'Ansible';
        addStatusUpdate(`Deleting ${stackType} stack: ${stackResult.stack.name}...`, 'info');
        
        try {
            const directResult = await spaceliftQuery(destroyStackMutation, {
                id: stackResult.stack.id,
                destroyResources: true
            });
            destroyResults.push({ 
                stack: stackResult.stack.name.includes('Opentofu') ? 'opentofu' : 'ansible', 
                stackId: stackResult.stack.id,
                deleted: true,
                result: directResult.stackDelete
            });
            addStatusUpdate(`✅ ${stackType} stack deleted successfully: ${stackResult.stack.name}`, 'success');
        } catch (error) {
            addStatusUpdate(`❌ ${stackType} stack deletion failed: ${error.message}`, 'error');
            destroyResults.push({ 
                stack: stackResult.stack.name.includes('Opentofu') ? 'opentofu' : 'ansible', 
                stackId: stackResult.stack.id,
                error: error.message 
            });
        }

        addStatusUpdate('Stack deletion process completed', 'success');
        return res.json({
            success: true,
            message: 'Stack deletion completed.',
            destroyResults,
            statusUpdates,
            worldSaved: false
        });
    }

    // If we reach here, handle server group deletion (less common case)
    addStatusUpdate('Server group deletion not implemented in this route', 'warning');
    
    return res.json({
        success: false,
        error: 'Server group deletion should be handled through the main server list',
        statusUpdates
    });
};

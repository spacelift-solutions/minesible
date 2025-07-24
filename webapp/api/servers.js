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

// Helper function to group stacks by blueprint deployment
function groupStacksByBlueprint(stacks) {
    const groups = {};
    
    stacks.forEach(stack => {
        let groupKey = null;
        let groupName = null;
        let isManual = false;
        
        // Check if it's a blueprint-created stack
        const blueprintMatch = stack.name.match(/Blueprint-([A-Za-z0-9]+)$/);
        if (blueprintMatch) {
            groupKey = blueprintMatch[1];
            groupName = `Blueprint-${groupKey}`;
        } else {
            // Handle manual stacks - look for common patterns
            const manualMatch = stack.name.match(/^(.*?)-(Opentofu|Ansible)(-.*)?$/i);
            if (manualMatch) {
                const baseName = manualMatch[1];
                const suffix = manualMatch[3] || '';
                groupKey = `${baseName}${suffix}`.replace(/[^A-Za-z0-9]/g, '');
                groupName = `Manual-${baseName}${suffix}`;
                isManual = true;
            } else {
                groupKey = stack.name.replace(/[^A-Za-z0-9]/g, '');
                groupName = `Individual-${stack.name}`;
                isManual = true;
            }
        }
        
        if (groupKey) {
            if (!groups[groupKey]) {
                groups[groupKey] = {
                    id: groupKey,
                    name: groupName,
                    status: 'Unknown',
                    ip: null,
                    instanceType: 'unknown',
                    maxPlayers: 'unknown',
                    created: null,
                    opentofu: null,
                    ansible: null,
                    isManual: isManual
                };
            }
            
            // Add stack to group and extract relevant info
            if (stack.name.toLowerCase().includes('opentofu')) {
                groups[groupKey].opentofu = {
                    id: stack.id,
                    name: stack.name,
                    status: stack.state
                };
                
                // Extract outputs from OpenTofu stack
                const outputs = stack.outputs ? stack.outputs.reduce((acc, output) => {
                    acc[output.id] = output.value;
                    return acc;
                }, {}) : {};
                
                // 🟢 NEW: Extract blueprint inputs from the stack
                const blueprintInputs = stack.blueprintInputs ? stack.blueprintInputs.reduce((acc, input) => {
                    acc[input.key] = input.value;
                    return acc;
                }, {}) : {};
                
                groups[groupKey].ip = outputs.ec2_ip || null;
                
                // 🟢 FIXED: Try blueprint inputs first, then outputs, then default
                groups[groupKey].instanceType = blueprintInputs.instance_type || outputs.instance_type || 'unknown';
                groups[groupKey].maxPlayers = blueprintInputs.max_players || outputs.max_players || 'unknown';
                groups[groupKey].created = stack.createdAt;
                
            } else if (stack.name.toLowerCase().includes('ansible')) {
                groups[groupKey].ansible = {
                    id: stack.id,
                    name: stack.name,
                    status: stack.state
                };
                
                if (!groups[groupKey].created) {
                    groups[groupKey].created = stack.createdAt;
                }
            } else {
                groups[groupKey].opentofu = {
                    id: stack.id,
                    name: stack.name,
                    status: stack.state
                };
                groups[groupKey].created = stack.createdAt;
            }
            
            // Determine overall status
            const opentofuStatus = groups[groupKey].opentofu?.status || 'Missing';
            const ansibleStatus = groups[groupKey].ansible?.status || 'Missing';
            groups[groupKey].status = determineOverallStatus(opentofuStatus, ansibleStatus);
        }
    });
    
    // Sort groups: Blueprint deployments first, then manual deployments
    const groupArray = Object.values(groups);
    groupArray.sort((a, b) => {
        if (a.isManual && !b.isManual) return 1;
        if (!a.isManual && b.isManual) return -1;
        return a.name.localeCompare(b.name);
    });
    
    return groupArray;
}

// Helper function to determine overall deployment status
function determineOverallStatus(opentofuStatus, ansibleStatus) {
    if (opentofuStatus === 'FINISHED' && ansibleStatus === 'FINISHED') {
        return 'Ready';
    } else if (opentofuStatus === 'FAILED' || ansibleStatus === 'FAILED') {
        return 'Failed';
    } else if (opentofuStatus === 'UNCONFIRMED' || ansibleStatus === 'UNCONFIRMED') {
        return 'Pending Confirmation';
    } else if (opentofuStatus === 'PLANNING' || ansibleStatus === 'PLANNING') {
        return 'Planning';
    } else if (opentofuStatus === 'APPLYING' || ansibleStatus === 'APPLYING') {
        return 'Deploying';
    } else if (opentofuStatus === 'Missing' || ansibleStatus === 'Missing') {
        return 'Incomplete';
    } else {
        return 'In Progress';
    }
}

module.exports = async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { method, url } = req;
        const urlParts = url.split('/').filter(part => part);
        
        // GET /api/servers - Get all servers
        if (method === 'GET' && urlParts.length === 2) {
            const getStacksQuery = `
                query GetStacks {
                    stacks {
                        id
                        name
                        state
                        createdAt
                        outputs {
                            id
                            value
                        }
                        labels
                    }
                }
            `;

            const result = await spaceliftQuery(getStacksQuery);
            
            const minesibleStacks = result.stacks.filter(stack => 
                stack.labels && stack.labels.includes('minesible')
            );

            const serverGroups = groupStacksByBlueprint(minesibleStacks);

            return res.json({
                success: true,
                servers: serverGroups
            });
        }

        // GET /api/servers/:serverId - Get specific server
        if (method === 'GET' && urlParts.length === 3) {
            const serverId = urlParts[2];
            
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
            
            if (!result.stack || !result.stack.labels.includes('minesible')) {
                return res.status(404).json({
                    success: false,
                    error: 'Server not found'
                });
            }

            const stack = result.stack;
            const outputs = stack.outputs.reduce((acc, output) => {
                acc[output.id] = output.value;
                return acc;
            }, {});

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

        // POST /api/servers/:serverId/save - Save world
        if (method === 'POST' && urlParts.length === 4 && urlParts[3] === 'save') {
            const serverId = urlParts[2];

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
            
            if (!stackResult.stack || !stackResult.stack.labels.includes('minesible')) {
                return res.status(404).json({
                    success: false,
                    error: 'Server not found'
                });
            }

            const randomString = stackResult.stack.name.split('-').pop();
            const ansibleStackName = `Minesible-Ansible-Blueprint-${randomString}`;

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
            const ansibleStack = allStacksResult.stacks.find(stack => stack.name === ansibleStackName);

            if (!ansibleStack) {
                return res.status(404).json({
                    success: false,
                    error: 'Ansible stack not found'
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
                taskId: taskResult.taskTrigger.id
            });
        }

        // GET /api/servers/:stackId/spacelift-logs - Get logs
        if (method === 'GET' && urlParts.length === 4 && urlParts[3] === 'spacelift-logs') {
            const stackId = urlParts[2];

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

            const stackResult = await spaceliftQuery(getStackWithRunsQuery, { stackId });
            
            if (!stackResult.stack) {
                return res.status(404).json({
                    success: false,
                    error: 'Stack not found'
                });
            }

            const stack = stackResult.stack;
            const runs = stack.runs || [];
            const latestRun = runs[0];

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
            }

            logInfo += `=== DETAILED LOGS ===
For complete execution logs with real-time updates, visit the Spacelift UI:
https://spacelift-solutions.app.spacelift.io/stack/${stackId}`;

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
                note: 'Complete execution logs available in Spacelift UI'
            });
        }

        // DELETE /api/servers/:serverId - Delete server
        if (method === 'DELETE' && urlParts.length === 3) {
            const serverId = urlParts[2];
            const body = JSON.parse(req.body || '{}');
            const { saveWorld } = body;

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
            
            if (!stackResult.stack || !stackResult.stack.labels.includes('minesible')) {
                return res.status(404).json({
                    success: false,
                    error: 'Server not found',
                    statusUpdates
                });
            }

            addStatusUpdate(`Found stack: ${stackResult.stack.name} (${stackResult.stack.state})`, 'info');

            // Handle direct stack deletion
            if (stackResult.stack.name.includes('Opentofu') || stackResult.stack.name.includes('Ansible')) {
                addStatusUpdate('Direct stack deletion detected', 'info');
                
                if (stackResult.stack.name.toLowerCase().includes('opentofu')) {
                    const blueprintMatch = stackResult.stack.name.match(/Blueprint-([A-Za-z0-9]+)$/);
                    if (blueprintMatch) {
                        const randomString = blueprintMatch[1];
                        const ansibleStackName = `Minesible-Ansible-Blueprint-${randomString}`;
                        
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
                            stack.name === ansibleStackName && stack.labels && stack.labels.includes('minesible')
                        );
                        
                        if (ansibleStack) {
                            addStatusUpdate(`Deleting Ansible stack first: ${ansibleStack.name}`, 'warning');
                            
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
                                addStatusUpdate(`✅ Ansible stack deleted: ${ansibleStack.name}`, 'success');
                                
                                // Wait before deleting OpenTofu stack
                                await new Promise(resolve => setTimeout(resolve, 10000));
                                
                            } catch (ansibleError) {
                                addStatusUpdate(`❌ Ansible stack deletion failed: ${ansibleError.message}`, 'error');
                                destroyResults.push({ 
                                    stack: 'ansible', 
                                    stackId: ansibleStack.id,
                                    error: ansibleError.message 
                                });
                            }
                        }
                    }
                }
                
                // Delete the requested stack
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
                    addStatusUpdate(`✅ ${stackType} stack deleted: ${stackResult.stack.name}`, 'success');
                } catch (error) {
                    addStatusUpdate(`❌ ${stackType} stack deletion failed: ${error.message}`, 'error');
                    destroyResults.push({ 
                        stack: stackResult.stack.name.includes('Opentofu') ? 'opentofu' : 'ansible', 
                        stackId: stackResult.stack.id,
                        error: error.message 
                    });
                }

                return res.json({
                    success: true,
                    message: 'Stack deletion completed.',
                    destroyResults,
                    statusUpdates,
                    worldSaved: false
                });
            }

            // Handle server group deletion
            const randomString = stackResult.stack.name.split('-').pop();
            const openTofuStackName = `Minesible-Opentofu-Blueprint-${randomString}`;
            const ansibleStackName = `Minesible-Ansible-Blueprint-${randomString}`;

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
            const allStacks = allStacksResult.stacks;
            
            const openTofuStack = allStacks.find(stack => 
                stack.name.toLowerCase() === openTofuStackName.toLowerCase() ||
                (stack.name.includes(randomString) && stack.name.toLowerCase().includes('opentofu'))
            );
            const ansibleStack = allStacks.find(stack => 
                stack.name.toLowerCase() === ansibleStackName.toLowerCase() ||
                (stack.name.includes(randomString) && stack.name.toLowerCase().includes('ansible'))
            );

            // Save world if requested
            if (saveWorld && ansibleStack && ansibleStack.state === 'FINISHED') {
                try {
                    const saveTaskMutation = `
                        mutation TriggerSaveTask($stackId: ID!, $command: String!) {
                            taskTrigger(
                                stack: $stackId,
                                command: $command
                            ) {
                                id
                                state
                            }
                        }
                    `;

                    const saveResult = await spaceliftQuery(saveTaskMutation, {
                        stackId: ansibleStack.id,
                        command: 'ansible-playbook save-world.yml'
                    });

                    await new Promise(resolve => setTimeout(resolve, 10000));
                    saveMessage = 'World saved to S3 before deletion. ';
                } catch (saveError) {
                    saveMessage = 'World save failed but continuing with deletion. ';
                }
            } else if (saveWorld) {
                saveMessage = 'World save requested but server not available for saving. ';
            } else {
                saveMessage = 'World not saved (user choice). ';
            }

            // Delete stacks
            if (ansibleStack) {
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
                } catch (error) {
                    destroyResults.push({ 
                        stack: 'ansible', 
                        stackId: ansibleStack.id,
                        error: error.message 
                    });
                }
            }

            if (openTofuStack) {
                if (ansibleStack) {
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
                
                try {
                    const openTofuResult = await spaceliftQuery(destroyStackMutation, {
                        id: openTofuStack.id,
                        destroyResources: true
                    });
                    destroyResults.push({ 
                        stack: 'opentofu', 
                        stackId: openTofuStack.id,
                        deleted: true,
                        result: openTofuResult.stackDelete
                    });
                } catch (error) {
                    destroyResults.push({ 
                        stack: 'opentofu', 
                        stackId: openTofuStack.id,
                        error: error.message 
                    });
                }
            }

            return res.json({
                success: true,
                message: `${saveMessage}Server deletion initiated.`,
                destroyResults,
                worldSaved: saveWorld && saveMessage.includes('saved')
            });
        }

        // If no route matches
        return res.status(404).json({
            success: false,
            error: 'API endpoint not found'
        });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

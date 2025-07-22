require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Export for VERCEL
module.exports = app;

// Middleware
app.use(express.json());
//app.use(express.static('public')); - REMOVED FOR VERCEL



// Spacelift API configuration | VERCEL REMOVED STATIC VARs for Key and Secret
const SPACELIFT_API_URL = process.env.SPACELIFT_API_ENDPOINT || 'https://spacelift-solutions.app.spacelift.io/graphql';

// Validation for Key and Secret: | VERCEL ADD
if (!SPACELIFT_API_KEY_ID || !SPACELIFT_API_KEY_SECRET) {
    console.error('Missing required environment variables:');
    console.error('- SPACELIFT_API_KEY_ID');
    console.error('- SPACELIFT_API_KEY_SECRET');
    process.exit(1);
}

if (!SPACELIFT_API_KEY_ID || !SPACELIFT_API_KEY_SECRET) {
    console.error('SPACELIFT_API_KEY_ID and SPACELIFT_API_KEY_SECRET environment variables are required');
    process.exit(1);
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
        
        console.log('JWT token obtained successfully');
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

// Blueprint ID
const BLUEPRINT_ID = 'minesible-blueprint-v2-01K0T0Z6H7XYTDEN4ST1D4SEXE';

// API Routes

// Debug endpoint to find correct destroy mutation
app.get('/api/debug-destroy-mutations', async (req, res) => {
    try {
        console.log('=== FINDING DESTROY MUTATIONS ===');
        
        const mutationQuery = `
            query {
                __type(name: "Mutation") {
                    fields {
                        name
                        args {
                            name
                            type {
                                name
                                kind
                            }
                        }
                    }
                }
            }
        `;

        const result = await spaceliftQuery(mutationQuery);
        
        // Find destroy/delete related mutations
        const destroyMutations = result.__type.fields.filter(field => 
            field.name.toLowerCase().includes('destroy') || 
            field.name.toLowerCase().includes('delete') ||
            field.name.toLowerCase().includes('run')
        );
        
        console.log('Destroy/Run mutations found:', destroyMutations.length);
        destroyMutations.forEach(mutation => {
            console.log(`${mutation.name}: ${JSON.stringify(mutation.args)}`);
        });
        
        res.json({
            success: true,
            mutations: destroyMutations
        });
        
    } catch (error) {
        console.error('Debug error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Debug endpoint to check API key permissions and user context
app.get('/api/debug-permissions', async (req, res) => {
    try {
        console.log('=== CHECKING API KEY PERMISSIONS ===');
        
        // Check current user and permissions
        const userQuery = `
            query {
                viewer {
                    id
                    name
                }
            }
        `;

        const userResult = await spaceliftQuery(userQuery);
        console.log('Current user:', userResult.viewer);
        
        // Check if we can access the specific space
        const spaceQuery = `
            query GetSpace($id: ID!) {
                space(id: $id) {
                    id
                    name
                    description
                }
            }
        `;

        const spaceResult = await spaceliftQuery(spaceQuery, { 
            id: "opentofu-01JB2XV5E3ZR3NDTKCN80KS6RH" 
        });
        console.log('Space access:', spaceResult.space);
        
        res.json({
            success: true,
            user: userResult.viewer,
            space: spaceResult.space
        });
        
    } catch (error) {
        console.error('Permission check error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test endpoint
app.get('/api/test', async (req, res) => {
    try {
        const testQuery = `
            query {
                viewer {
                    id
                    name
                }
            }
        `;

        const viewerResult = await spaceliftQuery(testQuery);

        const blueprintQuery = `
            query {
                searchBlueprints(input: {}) {
                    edges {
                        node {
                            id
                            name
                            description
                            state
                        }
                    }
                }
            }
        `;

        const blueprintResult = await spaceliftQuery(blueprintQuery);

        res.json({
            success: true,
            viewer: viewerResult.viewer,
            blueprints: blueprintResult.searchBlueprints.edges.map(edge => edge.node)
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Deploy a new server using blueprint
app.post('/api/deploy', async (req, res) => {
    try {
        const { instanceType, s3Bucket, motd, maxPlayers } = req.body;

        // Validate inputs
        if (!instanceType || !s3Bucket || !motd || !maxPlayers) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        console.log('=== STARTING DEPLOYMENT ===');
        console.log('Blueprint ID:', BLUEPRINT_ID);
        console.log('Deploy inputs:', { instanceType, s3Bucket, motd, maxPlayers });

        // Get blueprint details first
        const blueprintQuery = `
            query GetBlueprint($id: ID!) {
                blueprint(id: $id) {
                    id
                    name
                    space {
                        id
                        name
                    }
                    rawTemplate
                }
            }
        `;

        const blueprintResult = await spaceliftQuery(blueprintQuery, { id: BLUEPRINT_ID });
        console.log('Blueprint space:', blueprintResult.blueprint.space);
        
        console.log('Template is YAML format, both stacks specify space: opentofu-01JB2XV5E3ZR3NDTKCN80KS6RH');
        console.log('Blueprint should create stacks in the correct space automatically');

        // Prepare template inputs
        const templateInputs = [
            { id: 'instance_type', value: instanceType },
            { id: 's3_bucket', value: s3Bucket },
            { id: 'motd', value: motd },
            { id: 'max_players', value: maxPlayers.toString() }
        ];

        console.log('Template inputs:', templateInputs);
        console.log('Trying mutation with potential context fields...');
        
        // Create stack from blueprint
        const createStackMutation = `
            mutation CreateStackFromBlueprint($id: ID!, $input: BlueprintStackCreateInput!) {
                blueprintCreateStack(id: $id, input: $input) {
                    stackIds
                }
            }
        `;
        
        const mutationVariables = {
            id: BLUEPRINT_ID,
            input: {
                templateInputs: templateInputs
            }
        };

        // Let me also try adding a spaceId to the templateInputs themselves
        const templateInputsWithSpace = [
            ...templateInputs,
            { id: 'space_id', value: 'opentofu-01JB2XV5E3ZR3NDTKCN80KS6RH' }
        ];

        const mutationVariablesWithSpace = {
            id: BLUEPRINT_ID,
            input: {
                templateInputs: templateInputsWithSpace
            }
        };

        // Let's try with the root space instead of opentofu space
        const templateInputsWithRootSpace = [
            ...templateInputs,
            { id: 'space_id', value: 'root' }
        ];

        const mutationVariablesWithRootSpace = {
            id: BLUEPRINT_ID,
            input: {
                templateInputs: templateInputsWithRootSpace
            }
        };

        console.log('First attempt - original inputs:', JSON.stringify(mutationVariables, null, 2));
        
        let result;
        
        try {
            result = await spaceliftQuery(createStackMutation, mutationVariables);
            console.log('Success with original inputs!', result);
        } catch (firstError) {
            console.log('First attempt failed:', firstError.message);
            
            console.log('Second attempt - with space_id in templateInputs:', JSON.stringify(mutationVariablesWithSpace, null, 2));
            
            try {
                result = await spaceliftQuery(createStackMutation, mutationVariablesWithSpace);
                console.log('Success with space in templateInputs!', result);
            } catch (secondError) {
                console.log('Second attempt also failed:', secondError.message);
                
                console.log('Third attempt - with root space:', JSON.stringify(mutationVariablesWithRootSpace, null, 2));
                
                try {
                    result = await spaceliftQuery(createStackMutation, mutationVariablesWithRootSpace);
                    console.log('Success with root space!', result);
                } catch (thirdError) {
                    console.log('All attempts failed:', thirdError.message);
                    throw thirdError; // Re-throw the last error
                }
            }
        }
        
        const stackIds = result.blueprintCreateStack.stackIds;
        console.log('Created stacks:', stackIds);

        res.json({
            success: true,
            stackId: stackIds[0],
            stackName: `Stack ${stackIds[0]}`,
            allStackIds: stackIds
        });

    } catch (error) {
        console.error('Deploy error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get all servers
app.get('/api/servers', async (req, res) => {
    try {
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

        // Group stacks by blueprint deployment instead of returning individual stacks
        const serverGroups = groupStacksByBlueprint(minesibleStacks);

        res.json({
            success: true,
            servers: serverGroups
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

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
            // Expected manual patterns: "Minesible-Opentofu" and "Minesible-Ansible" (without Blueprint)
            // Or any stacks that have similar base names
            
            const manualMatch = stack.name.match(/^(.*?)-(Opentofu|Ansible)(-.*)?$/i);
            if (manualMatch) {
                const baseName = manualMatch[1];
                const suffix = manualMatch[3] || '';
                groupKey = `${baseName}${suffix}`.replace(/[^A-Za-z0-9]/g, ''); // Clean key
                groupName = `Manual-${baseName}${suffix}`;
                isManual = true;
            } else {
                // Fallback: treat each individual stack as its own group
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
                
                groups[groupKey].ip = outputs.ec2_ip || null;
                groups[groupKey].instanceType = outputs.instance_type || 'unknown';
                groups[groupKey].maxPlayers = outputs.max_players || 'unknown';
                groups[groupKey].created = stack.createdAt;
                
            } else if (stack.name.toLowerCase().includes('ansible')) {
                groups[groupKey].ansible = {
                    id: stack.id,
                    name: stack.name,
                    status: stack.state
                };
                
                // If OpenTofu didn't provide creation date, use Ansible's
                if (!groups[groupKey].created) {
                    groups[groupKey].created = stack.createdAt;
                }
            } else {
                // Handle other stack types (individual stacks)
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
    
    console.log('Grouped stacks:', groupArray); // Debug log
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

// Save world for a specific server
app.post('/api/servers/:serverId/save', async (req, res) => {
    try {
        const { serverId } = req.params;

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

        res.json({
            success: true,
            taskId: taskResult.taskTrigger.id
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Delete a server (with optional world saving)
app.delete('/api/servers/:serverId', async (req, res) => {
    // Declare all variables at the very beginning
    const destroyStackMutation = `
        mutation DeleteStack($id: ID!, $destroyResources: Boolean) {
            stackDelete(id: $id, destroyResources: $destroyResources) {
                id
            }
        }
    `;
    
    const destroyResults = [];
    let saveMessage = '';
    const statusUpdates = []; // Track status updates for frontend

    // Helper function to add status update
    function addStatusUpdate(message, type = 'info') {
        const update = {
            timestamp: new Date().toISOString(),
            message,
            type // 'info', 'success', 'warning', 'error'
        };
        statusUpdates.push(update);
        console.log(`[${type.toUpperCase()}] ${message}`);
    }

    try {
        const { serverId } = req.params;
        const { saveWorld } = req.body;
        
        addStatusUpdate('Starting server deletion process...', 'info');
        console.log('=== STARTING SERVER DELETION ===');
        console.log('Server ID:', serverId);
        console.log('Save world first:', saveWorld);

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

        // Check if this is a direct stack deletion
        if (stackResult.stack.name.includes('Opentofu') || stackResult.stack.name.includes('Ansible')) {
            addStatusUpdate('Direct stack deletion detected', 'info');
            console.log('Stack details:', { 
                id: stackResult.stack.id, 
                name: stackResult.stack.name, 
                state: stackResult.stack.state 
            });
            
            // For direct deletion, we need to handle dependencies
            // If deleting OpenTofu stack, find and delete Ansible stack first
            if (stackResult.stack.name.toLowerCase().includes('opentofu')) {
                addStatusUpdate('OpenTofu stack deletion - checking for dependent stacks...', 'info');
                console.log('OpenTofu stack deletion - checking for dependent Ansible stack...');
                
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
                        stack.name === ansibleStackName && stack.labels && stack.labels.includes('minesible')
                    );
                    
                    if (ansibleStack) {
                        addStatusUpdate(`Found dependent Ansible stack: ${ansibleStack.name} (${ansibleStack.state})`, 'info');
                        addStatusUpdate('Deleting Ansible stack first (dependency requirement)...', 'warning');
                        console.log(`Found dependent Ansible stack: ${ansibleStack.name} (${ansibleStack.state})`);
                        console.log('Deleting Ansible stack first...');
                        
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
                            console.log('Ansible stack deleted:', ansibleResult.stackDelete.id);
                            
                            // Wait a bit before deleting OpenTofu stack
                            addStatusUpdate('Waiting 10 seconds before deleting OpenTofu stack...', 'info');
                            console.log('Waiting 10 seconds before deleting OpenTofu stack...');
                            await new Promise(resolve => setTimeout(resolve, 10000));
                            
                        } catch (ansibleError) {
                            addStatusUpdate(`❌ Ansible stack deletion failed: ${ansibleError.message}`, 'error');
                            console.error('Ansible stack deletion failed:', ansibleError.message);
                            destroyResults.push({ 
                                stack: 'ansible', 
                                stackId: ansibleStack.id,
                                error: ansibleError.message 
                            });
                            addStatusUpdate('Continuing with OpenTofu deletion despite Ansible failure...', 'warning');
                        }
                    } else {
                        addStatusUpdate('No dependent Ansible stack found, proceeding with OpenTofu deletion', 'info');
                        console.log('No dependent Ansible stack found, proceeding with OpenTofu deletion');
                    }
                }
            } else {
                addStatusUpdate('Ansible stack deletion - no dependencies to check', 'info');
            }
            
            // Now delete the requested stack
            const mutationVars = {
                id: stackResult.stack.id,
                destroyResources: true
            };
            
            const stackType = stackResult.stack.name.includes('Opentofu') ? 'OpenTofu' : 'Ansible';
            addStatusUpdate(`Deleting ${stackType} stack: ${stackResult.stack.name}...`, 'info');
            console.log('Deleting requested stack with variables:', JSON.stringify(mutationVars, null, 2));
            
            if (!stackResult.stack.id) {
                const errorMsg = 'Stack ID is null or undefined';
                addStatusUpdate(`❌ Error: ${errorMsg}`, 'error');
                console.error('ERROR: Stack ID is null/undefined!');
                destroyResults.push({ 
                    stack: stackResult.stack.name.includes('Opentofu') ? 'opentofu' : 'ansible', 
                    stackId: 'NULL_ID',
                    error: errorMsg
                });
            } else {
                try {
                    const directResult = await spaceliftQuery(destroyStackMutation, mutationVars);
                    destroyResults.push({ 
                        stack: stackResult.stack.name.includes('Opentofu') ? 'opentofu' : 'ansible', 
                        stackId: stackResult.stack.id,
                        deleted: true,
                        result: directResult.stackDelete
                    });
                    addStatusUpdate(`✅ ${stackType} stack deleted successfully: ${stackResult.stack.name}`, 'success');
                    console.log('Stack deleted successfully:', directResult.stackDelete.id);
                } catch (error) {
                    addStatusUpdate(`❌ ${stackType} stack deletion failed: ${error.message}`, 'error');
                    console.error('Stack deletion failed:', error.message);
                    destroyResults.push({ 
                        stack: stackResult.stack.name.includes('Opentofu') ? 'opentofu' : 'ansible', 
                        stackId: stackResult.stack.id,
                        error: error.message 
                    });
                }
            }

            addStatusUpdate('Stack deletion process completed', 'success');
            console.log('Direct deletion process completed:', destroyResults);
            return res.json({
                success: true,
                message: 'Stack deletion completed.',
                destroyResults,
                statusUpdates,
                worldSaved: false
            });
        }

        // If we reach here, it's a server group deletion
        const randomString = stackResult.stack.name.split('-').pop();
        const openTofuStackName = `Minesible-Opentofu-Blueprint-${randomString}`;
        const ansibleStackName = `Minesible-Ansible-Blueprint-${randomString}`;

        console.log('Looking for stacks:', { openTofuStackName, ansibleStackName });

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

        console.log('Found stacks:', {
            openTofu: openTofuStack ? `${openTofuStack.id} (${openTofuStack.state})` : 'Not found',
            ansible: ansibleStack ? `${ansibleStack.id} (${ansibleStack.state})` : 'Not found'
        });

        // Save world if requested
        if (saveWorld && ansibleStack && ansibleStack.state === 'FINISHED') {
            console.log('User requested world save - saving world before deletion...');
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

                console.log('World save task triggered:', saveResult.taskTrigger.id);
                await new Promise(resolve => setTimeout(resolve, 10000));
                saveMessage = 'World saved to S3 before deletion. ';
            } catch (saveError) {
                console.warn('World save failed:', saveError.message);
                saveMessage = 'World save failed but continuing with deletion. ';
            }
        } else if (saveWorld) {
            saveMessage = 'World save requested but server not available for saving. ';
        } else {
            saveMessage = 'World not saved (user choice). ';
        }

        // Delete stacks
        if (ansibleStack) {
            console.log('Deleting Ansible stack...');
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
                console.log('Ansible stack deleted:', ansibleResult.stackDelete.id);
            } catch (error) {
                console.error('Ansible stack deletion failed:', error.message);
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
            
            console.log('Deleting OpenTofu stack...');
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
                console.log('OpenTofu stack deleted:', openTofuResult.stackDelete.id);
            } catch (error) {
                console.error('OpenTofu stack deletion failed:', error.message);
                destroyResults.push({ 
                    stack: 'opentofu', 
                    stackId: openTofuStack.id,
                    error: error.message 
                });
            }
        }

        console.log('Deletion process completed:', destroyResults);

        res.json({
            success: true,
            message: `${saveMessage}Server deletion initiated.`,
            destroyResults,
            worldSaved: saveWorld && saveMessage.includes('saved')
        });

    } catch (error) {
        console.error('Delete server error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Force delete endpoint (skip world save)
app.delete('/api/servers/:serverId/force', async (req, res) => {
    try {
        const { serverId } = req.params;
        console.log('=== FORCE DELETING SERVER ===');

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
        const openTofuStackName = `Minesible-Opentofu-Blueprint-${randomString}`;
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
        const allStacks = allStacksResult.stacks;
        
        const openTofuStack = allStacks.find(stack => stack.name === openTofuStackName);
        const ansibleStack = allStacks.find(stack => stack.name === ansibleStackName);

        const forceDeleteMutation = `
            mutation ForceDeleteStack($id: ID!, $destroyResources: Boolean) {
                stackDelete(id: $id, destroyResources: $destroyResources) {
                    id
                }
            }
        `;

        const deleteResults = [];

        if (ansibleStack) {
            try {
                await spaceliftQuery(forceDeleteMutation, {
                    id: ansibleStack.id,
                    destroyResources: true
                });
                deleteResults.push({ stack: 'ansible', stackId: ansibleStack.id, status: 'deleted' });
            } catch (error) {
                deleteResults.push({ stack: 'ansible', stackId: ansibleStack.id, error: error.message });
            }
        }

        if (openTofuStack) {
            try {
                await spaceliftQuery(forceDeleteMutation, {
                    id: openTofuStack.id,
                    destroyResources: true
                });
                deleteResults.push({ stack: 'opentofu', stackId: openTofuStack.id, status: 'deleted' });
            } catch (error) {
                deleteResults.push({ stack: 'opentofu', stackId: openTofuStack.id, error: error.message });
            }
        }

        res.json({
            success: true,
            message: 'Force deletion completed',
            deleteResults
        });

    } catch (error) {
        console.error('Force delete error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get Spacelift logs for a specific stack
app.get('/api/servers/:stackId/spacelift-logs', async (req, res) => {
    // Helper function to format dates properly
    const formatDate = (dateValue) => {
        if (!dateValue) return 'Unknown';
        
        let date;
        if (typeof dateValue === 'number') {
            // If it's a Unix timestamp (seconds), convert to milliseconds
            date = new Date(dateValue > 1000000000000 ? dateValue : dateValue * 1000);
        } else {
            // If it's a string, parse it
            date = new Date(dateValue);
        }
        
        // Check if date is valid and not the Unix epoch (1970)
        if (isNaN(date.getTime()) || date.getFullYear() < 2020) {
            return 'Invalid date';
        }
        
        return date.toLocaleString();
    };

    try {
        const { stackId } = req.params;

        console.log('=== FETCHING SPACELIFT LOGS ===');
        console.log('Stack ID:', stackId);

        // The correct way to get stack runs in Spacelift GraphQL API
        // Fixed field names based on actual schema
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
        console.log('Stack found:', stack.name, 'State:', stack.state);

        // Get the most recent run
        const runs = stack.runs || [];
        const latestRun = runs[0]; // Runs are typically sorted by newest first
        
        console.log('Found runs:', runs.length);

        // Create informative response
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
For complete execution logs with real-time updates, including:
• Complete Terraform/OpenTofu plan and apply output
• Ansible playbook execution details
• Error messages and troubleshooting information
• Live streaming during active runs

Visit the Spacelift UI: https://spacelift-solutions.app.spacelift.io/stack/${stackId}`;

        res.json({
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

    } catch (error) {
        console.error('Error fetching Spacelift logs:', error.message);
        
        // If it's a GraphQL error, it might be a schema issue
        if (error.message.includes('Cannot query field')) {
            console.log('GraphQL schema error - falling back to basic stack info');
            
            // Fallback to basic stack info only
            try {
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
                
                const basicResult = await spaceliftQuery(basicStackQuery, { id: stackId });
                
                if (basicResult.stack) {
                    const fallbackInfo = `=== STACK INFORMATION ===
Stack Name: ${basicResult.stack.name}
Stack ID: ${basicResult.stack.id}
Current State: ${basicResult.stack.state}
Created: ${formatDate(basicResult.stack.createdAt)}

=== LOGS ACCESS ===
The Spacelift GraphQL API has limited log access through the API.
For complete execution logs, visit the Spacelift UI directly:

https://spacelift-solutions.app.spacelift.io/stack/${stackId}

There you can view:
• Real-time execution logs
• Complete Terraform/OpenTofu output  
• Ansible playbook execution
• Error messages and debugging info
• Historical run data
`;

                    return res.json({
                        success: true,
                        logs: fallbackInfo,
                        stackName: basicResult.stack.name,
                        note: 'GraphQL API limitations - use Spacelift UI for full logs'
                    });
                }
            } catch (fallbackError) {
                console.error('Fallback query also failed:', fallbackError.message);
            }
        }
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/servers/:serverId', async (req, res) => {
    try {
        const { serverId } = req.params;

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

        res.json({
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

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Serve main page -  REMOVED FOR VERCEL
//app.get('/', (req, res) => {
//    res.sendFile(path.join(__dirname, 'public', 'index.html'));
//});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// Start server
if (process.env.NODE_ENV !== 'production') { // VERCEL ADD
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Open http://localhost:${PORT} to access the Minecraft Server Manager`);
    }); // VERCEL ADD
} // VERCEL ADD

module.exports = app;

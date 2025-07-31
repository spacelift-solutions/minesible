require('dotenv').config();
const axios = require('axios');

// Spacelift API configuration
const SPACELIFT_API_URL = process.env.SPACELIFT_API_ENDPOINT;
const SPACELIFT_API_KEY_ID = process.env.SPACELIFT_API_KEY_ID;
const SPACELIFT_API_KEY_SECRET = process.env.SPACELIFT_API_KEY_SECRET;

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
    console.log('=== LOGS FUNCTION STARTED ===');
    console.log('Method:', req.method);
    console.log('Query:', req.query);
    
    try {
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        
        if (req.method === 'OPTIONS') {
            return res.status(200).end();
        }

        if (req.method !== 'GET') {
            return res.status(405).json({
                success: false,
                error: 'Method not allowed. Use GET.'
            });
        }

        // Get stackId from query parameter
        const { stackId } = req.query;
        
        if (!stackId) {
            return res.status(400).json({
                success: false,
                error: 'Missing stackId parameter'
            });
        }

        console.log('=== FETCHING SPACELIFT LOGS ===');
        console.log('Stack ID:', stackId);

        // Helper function to format dates properly
        const formatDate = (dateValue) => {
            try {
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
            } catch (error) {
                console.error('Date formatting error:', error);
                return 'Date error';
            }
        };

        // Try to get stack runs with error handling
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
            console.log('Attempting to get stack with runs...');
            stackResult = await spaceliftQuery(getStackWithRunsQuery, { stackId });
            console.log('Stack with runs query successful');
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
                console.log('Basic stack query successful');
            } catch (basicError) {
                console.error('Both queries failed:', basicError.message);
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
        console.log('Stack found:', stack.name, 'State:', stack.state);

        // Get the runs (may be undefined if basic query was used)
        const runs = stack.runs || [];
        const latestRun = runs[0];
        
        console.log('Found runs:', runs.length);

        // Create informative response with safe string handling
        let logInfo = '';
        
        try {
            logInfo += `=== STACK INFORMATION ===\n`;
            logInfo += `Stack Name: ${stack.name}\n`;
            logInfo += `Stack ID: ${stack.id}\n`;
            logInfo += `Current State: ${stack.state}\n`;
            logInfo += `Created: ${formatDate(stack.createdAt)}\n\n`;

            if (latestRun) {
                logInfo += `=== LATEST RUN ===\n`;
                logInfo += `Run ID: ${latestRun.id}\n`;
                logInfo += `Type: ${latestRun.type}\n`;
                logInfo += `State: ${latestRun.state}\n`;
                logInfo += `Branch: ${latestRun.branch || 'N/A'}\n`;
                logInfo += `Triggered By: ${latestRun.triggeredBy || 'Unknown'}\n`;
                logInfo += `Started: ${formatDate(latestRun.createdAt)}\n`;
                logInfo += `${latestRun.finished ? `Finished: ${formatDate(latestRun.finished)}` : 'Still running...'}\n\n`;
            }

            if (runs.length > 1) {
                logInfo += `=== RECENT RUNS ===\n`;
                runs.slice(1, 6).forEach((run, index) => {
                    logInfo += `${index + 2}. ${run.type} - ${run.state} - ${formatDate(run.createdAt)}\n`;
                });
                logInfo += `\n`;
            } else if (runs.length === 0) {
                logInfo += `=== RUN HISTORY ===\n`;
                logInfo += `No run history available through API.\n\n`;
            }

            logInfo += `=== DETAILED LOGS ===\n`;
            logInfo += `For complete execution logs with real-time updates, including:\n`;
            logInfo += `• Complete Terraform/OpenTofu plan and apply output\n`;
            logInfo += `• Ansible playbook execution details\n`;
            logInfo += `• Error messages and troubleshooting information\n`;
            logInfo += `• Live streaming during active runs\n\n`;
            logInfo += `Visit the Spacelift UI: https://spacelift-solutions.app.spacelift.io/stack/${stackId}\n\n`;
            logInfo += `=== API LIMITATIONS ===\n`;
            logInfo += `The Spacelift GraphQL API has limited log access. For full logs:\n`;
            logInfo += `1. Click the link above to view in Spacelift UI`;

        } catch (stringError) {
            console.error('String building error:', stringError);
            logInfo = `Error building log information: ${stringError.message}`;
        }

        console.log('Successfully built log info, returning response');

        return res.status(200).json({
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

    } catch (error) {
        console.error('=== FUNCTION ERROR ===');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error',
            debug: {
                stack: error.stack,
                name: error.name
            }
        });
    }
};

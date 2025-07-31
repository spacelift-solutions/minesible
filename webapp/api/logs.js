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

    try {
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
        console.log('Stack found:', stack.name, 'State:', stack.state);

        // Get the runs (may be undefined if basic query was used)
        const runs = stack.runs || [];
        const latestRun = runs[0];
        
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
        } else if (runs.length === 0) {
            logInfo += `=== RUN HISTORY ===
No run history available through API.

`;
        }

        logInfo += `=== DETAILED LOGS ===
For complete execution logs with real-time updates, including:
• Complete Terraform/OpenTofu plan and apply output
• Ansible playbook execution details
• Error messages and troubleshooting information
• Live streaming during active runs

Visit the Spacelift UI: https://spacelift-solutions.app.spacelift.io/stack/${stackId}

=== API LIMITATIONS ===
The Spacelift GraphQL API has limited log access. For full logs:
1. Click the link above to view in Spacelift UI

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

    } catch (error) {
        console.error('Error fetching Spacelift logs:', error.message);
        
        return res.status(500).json({
            success: false,
            error: error.message,
            suggestion: 'Try accessing logs directly in the Spacelift UI',
            spaceliftUrl: req.query.stackId ? `https://spacelift-solutions.app.spacelift.io/stack/${req.query.stackId}` : null
        });
    }
};

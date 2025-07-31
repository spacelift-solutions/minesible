require('dotenv').config();
const axios = require('axios');

// Spacelift API configuration
const SPACELIFT_API_URL = process.env.SPACELIFT_API_ENDPOINT;
const SPACELIFT_API_KEY_ID = process.env.SPACELIFT_API_KEY_ID;
const SPACELIFT_API_KEY_SECRET = process.env.SPACELIFT_API_KEY_SECRET;

// Blueprint ID
const BLUEPRINT_ID = process.env.BLUEPRINT_ID || 'minesible-blueprint-webinar-01K1GRYDY24BS8AQAT97GCVR85';

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
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed. Use POST.'
        });
    }

    try {
        const { instanceType, s3Bucket, motd, maxPlayers } = req.body;

        // Validate inputs
        if (!instanceType || !s3Bucket || !motd || !maxPlayers) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: instanceType, s3Bucket, motd, maxPlayers'
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
        
        if (!blueprintResult.blueprint) {
            return res.status(404).json({
                success: false,
                error: `Blueprint not found: ${BLUEPRINT_ID}`
            });
        }

        console.log('Blueprint found:', blueprintResult.blueprint.name);
        console.log('Blueprint space:', blueprintResult.blueprint.space);

        // Prepare template inputs
        const templateInputs = [
            { id: 'instance_type', value: instanceType },
            { id: 's3_bucket', value: s3Bucket },
            { id: 'motd', value: motd },
            { id: 'max_players', value: maxPlayers.toString() }
        ];

        console.log('Template inputs:', templateInputs);
        
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

        console.log('Creating stack with variables:', JSON.stringify(mutationVariables, null, 2));
        
        let result;
        
        try {
            result = await spaceliftQuery(createStackMutation, mutationVariables);
            console.log('Stack creation successful:', result);
        } catch (firstError) {
            console.log('First attempt failed:', firstError.message);
            
            // Try with space_id in templateInputs
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

            console.log('Second attempt with space_id:', JSON.stringify(mutationVariablesWithSpace, null, 2));
            
            try {
                result = await spaceliftQuery(createStackMutation, mutationVariablesWithSpace);
                console.log('Success with space in templateInputs:', result);
            } catch (secondError) {
                console.log('Second attempt failed:', secondError.message);
                
                // Try with root space
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

                console.log('Third attempt with root space:', JSON.stringify(mutationVariablesWithRootSpace, null, 2));
                
                try {
                    result = await spaceliftQuery(createStackMutation, mutationVariablesWithRootSpace);
                    console.log('Success with root space:', result);
                } catch (thirdError) {
                    console.log('All attempts failed:', thirdError.message);
                    throw thirdError;
                }
            }
        }
        
        const stackIds = result.blueprintCreateStack.stackIds;
        console.log('Created stacks:', stackIds);

        if (!stackIds || stackIds.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'No stacks were created from the blueprint'
            });
        }

        return res.json({
            success: true,
            stackId: stackIds[0],
            stackName: `Stack ${stackIds[0]}`,
            allStackIds: stackIds,
            message: 'Server deployment initiated successfully!'
        });

    } catch (error) {
        console.error('Deploy error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Deployment failed'
        });
    }
};

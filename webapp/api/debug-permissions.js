// Debug permissions endpoint

require('dotenv').config();
const axios = require('axios');

const SPACELIFT_API_URL = process.env.SPACELIFT_API_ENDPOINT;
const SPACELIFT_API_KEY_ID = process.env.SPACELIFT_API_KEY_ID;
const SPACELIFT_API_KEY_SECRET = process.env.SPACELIFT_API_KEY_SECRET;

let currentJWT = null;
let jwtExpiry = null;

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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

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
        
        return res.json({
            success: true,
            user: userResult.viewer,
            space: spaceResult.space
        });
        
    } catch (error) {
        console.error('Permission check error:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

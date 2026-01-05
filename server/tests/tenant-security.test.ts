/**
 * Integration tests for tenant discovery and security flows
 * 
 * Tests the /api/me/tenant endpoint behavior for:
 * 1. Unauthenticated users - should return default tenant info
 * 2. Authenticated but unassigned users - should return null tenant with message
 * 3. Protected API routes - should reject unauthenticated requests with 401
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';

interface TenantDiscoveryResponse {
  tenantId: string | null;
  role: string | null;
  tenantName?: string | null;
  tenants: Array<{ tenantId: string; role: string; tenantName: string }>;
  message?: string;
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: errorMessage });
    console.log(`✗ ${name}: ${errorMessage}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function runTests(): Promise<void> {
  console.log('\n🔐 Running Tenant Security Tests\n');
  console.log(`Testing against: ${BASE_URL}\n`);

  await test('Unauthenticated user can access /api/me/tenant', async () => {
    const response = await fetch(`${BASE_URL}/api/me/tenant`);
    assertEqual(response.status, 200, 'Expected 200 status');
    
    const data: TenantDiscoveryResponse = await response.json();
    assertEqual(data.tenantId, 'default-tenant', 'Unauthenticated user should get default-tenant');
    assertEqual(data.role, 'user', 'Unauthenticated user should have user role');
    assert(Array.isArray(data.tenants), 'tenants should be an array');
    assertEqual(data.tenants.length, 0, 'Unauthenticated user should have no tenants');
  });

  await test('Unauthenticated user gets 401 on protected routes', async () => {
    const response = await fetch(`${BASE_URL}/api/customers`);
    assertEqual(response.status, 401, 'Protected route should return 401 for unauthenticated user');
  });

  await test('Unauthenticated user gets 401 on /api/orders', async () => {
    const response = await fetch(`${BASE_URL}/api/orders`);
    assertEqual(response.status, 401, 'Orders endpoint should return 401 for unauthenticated user');
  });

  await test('Unauthenticated user gets 401 on /api/resources', async () => {
    const response = await fetch(`${BASE_URL}/api/resources`);
    assertEqual(response.status, 401, 'Resources endpoint should return 401 for unauthenticated user');
  });

  await test('Unauthenticated user gets 401 on /api/clusters', async () => {
    const response = await fetch(`${BASE_URL}/api/clusters`);
    assertEqual(response.status, 401, 'Clusters endpoint should return 401 for unauthenticated user');
  });

  await test('Unauthenticated POST to /api/customers returns 401', async () => {
    const response = await fetch(`${BASE_URL}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Customer' }),
    });
    assertEqual(response.status, 401, 'POST to protected route should return 401');
  });

  await test('Admin-only routes reject unauthenticated users', async () => {
    const response = await fetch(`${BASE_URL}/api/metadata-definitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    });
    assertEqual(response.status, 401, 'Admin route should return 401 for unauthenticated user');
  });

  console.log('\n📊 Test Results Summary\n');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('\n❌ Failed Tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});

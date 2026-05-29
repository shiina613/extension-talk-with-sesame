---
inclusion: always
---

# Modular Architecture & Clean Code Guidelines

## Core Philosophy

Code phải được thiết kế như các **khối lắp ghép độc lập**. Mỗi module tự chứa đủ logic của mình, giao tiếp với bên ngoài qua interface rõ ràng. Khi có bug, chỉ cần mở đúng module đó để sửa — không lan sang module khác.

## Project Structure

### Feature-based Modular Structure
```
src/
  modules/
    {module-name}/
      index.ts              ← Public API (chỉ export những gì module khác cần)
      {module-name}.service.ts
      {module-name}.controller.ts
      {module-name}.repository.ts
      {module-name}.types.ts
      {module-name}.constants.ts
      {module-name}.test.ts
      internal/             ← Logic nội bộ, KHÔNG export ra ngoài
        helpers.ts
        validators.ts
  shared/
    interfaces/             ← Contracts giữa các module
    types/                  ← Shared types
    utils/                  ← Pure utility functions
    constants/
```

### Module Rules

1. **Mỗi module có 1 file `index.ts`** — đây là cửa duy nhất để module khác truy cập
2. **Không import trực tiếp file bên trong module khác** — chỉ import từ `index.ts`
3. **Folder `internal/`** chứa logic nội bộ, không ai bên ngoài được dùng
4. **Module không biết chi tiết bên trong module khác** — chỉ biết interface

### Example
```typescript
// ❌ Sai - import trực tiếp file nội bộ của module khác
import { hashPassword } from '../auth/internal/crypto';

// ✅ Đúng - import từ public API
import { AuthService } from '../auth';
```

## Module Communication

### Nguyên tắc Loose Coupling

- Module giao tiếp qua **interface/contract**, không qua implementation
- Dùng **Dependency Injection** để truyền dependency
- Dùng **Events/EventBus** cho communication không đồng bộ giữa modules
- Không circular dependency: nếu A phụ thuộc B thì B không được phụ thuộc A

### Contract Pattern
```typescript
// shared/interfaces/payment.interface.ts
export interface PaymentProcessor {
  charge(amount: number, currency: string): Promise<PaymentResult>;
  refund(transactionId: string): Promise<RefundResult>;
}

// modules/stripe/index.ts — implement contract
export class StripePayment implements PaymentProcessor { ... }

// modules/orders/orders.service.ts — dùng contract, không biết Stripe
constructor(private payment: PaymentProcessor) {}
```

### Event-Based Communication
```typescript
// Module A phát event, không cần biết ai lắng nghe
eventBus.emit('order.created', { orderId, userId });

// Module B lắng nghe, không cần biết ai phát
eventBus.on('order.created', (data) => {
  notificationService.sendOrderConfirmation(data);
});
```

## Isolation Rules

1. **Mỗi module quản lý data riêng** — không truy cập trực tiếp database/table của module khác
2. **Mỗi module có test riêng** — test chạy độc lập, mock dependencies bên ngoài
3. **Mỗi module có error handling riêng** — custom errors cho domain của mình
4. **Config riêng** — mỗi module khai báo config nó cần

## Khi nào tách module mới?

- Khi một nhóm logic có thể **xóa bỏ hoàn toàn** mà không ảnh hưởng phần còn lại
- Khi logic đó có **data riêng** và **business rules riêng**
- Khi 2 developer có thể làm song song mà không conflict

## Naming Conventions

- **Files**: kebab-case (`user-profile.service.ts`)
- **Classes**: PascalCase (`UserProfileService`)
- **Functions/methods**: camelCase, bắt đầu bằng động từ (`getUserById`, `calculateTotal`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRY_COUNT`)
- **Booleans**: prefix `is`, `has`, `can`, `should` (`isActive`, `hasPermission`)
- **Interfaces/Types**: PascalCase, không prefix `I` (`UserProfile`, not `IUserProfile`)
- **Module folder**: kebab-case (`order-management/`)

## Function Rules

1. **Single Responsibility**: Mỗi function làm MỘT việc
2. **Max 20-30 dòng**: Dài hơn → tách sub-function
3. **Max 3 parameters**: Nhiều hơn → dùng options object
4. **Early return**: Xử lý edge case trước, tránh nested if
5. **Pure function khi có thể**: Cùng input → cùng output, không side effect
6. **Một mức abstraction**: Không trộn logic high-level và low-level

```typescript
// ✅ Good - early return, single responsibility
function processOrder(order: Order): Result {
  if (!order) return Result.fail('Order is required');
  if (!order.isValid()) return Result.fail('Invalid order');
  if (!order.hasItems()) return Result.fail('Order has no items');

  const total = calculateTotal(order.items);
  return Result.ok(total);
}
```

## Error Handling

- Mỗi module định nghĩa custom error classes riêng
- Error không leak implementation detail ra ngoài module
- Dùng Result/Either pattern cho expected failures
- Chỉ throw cho unexpected errors (bugs thật sự)

```typescript
// modules/orders/errors.ts
export class OrderNotFoundError extends DomainError {
  constructor(orderId: string) {
    super(`Order ${orderId} not found`);
  }
}
```

## Code Smells to Avoid

- ❌ God class/function (làm quá nhiều việc)
- ❌ Magic numbers (dùng named constants)
- ❌ Deep nesting (max 2-3 levels)
- ❌ Circular dependencies giữa modules
- ❌ Import file nội bộ của module khác
- ❌ Shared mutable state giữa modules
- ❌ Comments giải thích WHAT (code phải tự giải thích)
- ✅ Comments giải thích WHY (quyết định business, workaround)

## Testing

- Test file nằm cạnh source: `orders.service.ts` → `orders.service.test.ts`
- Mock tất cả dependencies bên ngoài module
- Test behavior, không test implementation
- Tên test mô tả rõ: `should return error when order not found`
- Arrange-Act-Assert pattern

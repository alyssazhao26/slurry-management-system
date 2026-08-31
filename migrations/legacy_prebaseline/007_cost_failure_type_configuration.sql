CREATE TABLE IF NOT EXISTS system_import.cost_failure_types (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    type_code VARCHAR(80) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    definition TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cost_failure_type_code (type_code)
);

INSERT IGNORE INTO system_import.cost_failure_types (type_code, display_name, definition) VALUES
('lost_production', 'Lost production / 产量损失', 'Planned output that could not be produced / 未能生产的计划产量'),
('scrap_rework', 'Scrap or rework / 报废或返工', 'Value of rejected product or work required to repair it / 不合格产品或返工成本'),
('material_loss', 'Material loss / 材料损失', 'Raw material, slurry, packaging, or consumables lost / 损失的原料、浆料、包装或耗材'),
('labour_overtime', 'Labour overtime / 人工加班', 'Additional labour required because of the event / 因异常产生的额外人工'),
('maintenance_repair', 'Maintenance or repair / 维护或维修', 'Parts, contractors, or repair work / 零件、承包商或维修工作'),
('energy_waste', 'Energy waste / 能源浪费', 'Energy consumed without useful output / 未产生有效产出的能源'),
('customer_delivery_impact', 'Customer or delivery impact / 客户或交付影响', 'Expedite, penalty, or delivery disruption risk / 加急、罚款或交付中断风险'),
('safety_environmental_impact', 'Safety or environmental impact / 安全或环境影响', 'Potential safety, cleanup, compliance, or environmental cost / 潜在安全、清理、合规或环境成本');

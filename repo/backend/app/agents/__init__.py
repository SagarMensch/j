"""
Agent Registry - Maps agent types to their implementations.
"""
from app.agents.orchestrator import AgentType
from app.agents.sop_agent import SOPAgent
from app.agents.training_agent import TrainingAgent
from app.agents.quiz_agent import QuizAgent
from app.agents.safety_agent import SafetyAgent
from app.agents.equipment_agent import EquipmentAgent
from app.agents.appeal_agent import AppealAgent
from app.agents.analytics_agent import AnalyticsAgent
from app.agents.general_agent import GeneralAgent


AGENT_REGISTRY: dict[AgentType, type] = {
    AgentType.SOP: SOPAgent,
    AgentType.TRAINING: TrainingAgent,
    AgentType.QUIZ: QuizAgent,
    AgentType.SAFETY: SafetyAgent,
    AgentType.EQUIPMENT: EquipmentAgent,
    AgentType.APPEAL: AppealAgent,
    AgentType.ANALYTICS: AnalyticsAgent,
    AgentType.GENERAL: GeneralAgent,
}

_agent_instances: dict[AgentType, object] = {}


def get_agent(agent_type: AgentType):
    if agent_type not in _agent_instances:
        agent_class = AGENT_REGISTRY.get(agent_type)
        if agent_class:
            _agent_instances[agent_type] = agent_class()
    return _agent_instances.get(agent_type)


def get_all_agents():
    for agent_type in AgentType:
        get_agent(agent_type)
    return _agent_instances

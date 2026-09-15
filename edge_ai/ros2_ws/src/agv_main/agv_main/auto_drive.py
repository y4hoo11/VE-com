import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist
import time

class AutoDriveNode(Node):
    def __init__(self):
        super().__init__('auto_drive_node')
        # /cmd_vel トピックへメッセージを発行するパブリッシャーを作成
        self.publisher = self.create_publisher(Twist, '/cmd_vel', 10)
        
        # 10Hz (0.1秒周期) でタイマー処理を実行
        self.timer = self.create_timer(0.1, self.timer_callback)
        self.start_time = time.time()
        self.get_logger().info('自動移動ノードを開始しました')

    def timer_callback(self):
        msg = Twist()
        elapsed_time = time.time() - self.start_time

        if elapsed_time < 3.0:
            # 0〜3秒: 前進 (0.2 m/s)
            msg.linear.x = 0.2
            msg.angular.z = 0.0
            self.get_logger().info('前進中...')

        elif elapsed_time < 5.0:
            # 3〜5秒: 左旋回 (0.5 rad/s)
            msg.linear.x = 0.0
            msg.angular.z = 0.5
            self.get_logger().info('旋回中...')

        elif elapsed_time < 8.0:
            # 5〜8秒: 後退 (-0.2 m/s)
            msg.linear.x = -0.2
            msg.angular.z = 0.0
            self.get_logger().info('後退中...')

        else:
            # 8秒以降: 停止
            msg.linear.x = 0.0
            msg.angular.z = 0.0
            self.get_logger().info('停止しました')

        self.publisher.publish(msg)

def main(args=None):
    rclpy.init(args=args)
    node = AutoDriveNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()